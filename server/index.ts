import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import Database from 'better-sqlite3';
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  upsertUser,
  getUser,
  userHasOpenAiApiKey,
  getUserOpenAiApiKey,
  updateUserOpenAiApiKey,
  listPursuits,
  createPursuit,
  updatePursuit,
  deletePursuit,
  pursuitOwnedBy,
  artifactOwnedBy,
  listArtifacts,
  createArtifact,
  updateArtifact,
  deleteArtifact,
  listConnections,
  connectionOwnedBy,
  deleteConnection,
  unscannedPairs,
  recordScanResults,
  communityMembers,
  publicConnections,
  exportUserDb,
  importUserDb,
} from './db';
import { pursuitIsPublic } from './db';
import { findConnections, llmConfigured, LlmNotConfiguredError, type ArtifactForScan } from './llm';
import { emitFeedEvent } from './events';
import { socialRouter } from './social';

// Clerk is optional: without keys Polygon runs in solo mode, exactly the
// original local-first behavior, with all rows owned by the 'local' user.
const CLERK_ENABLED = Boolean(process.env.CLERK_SECRET_KEY);

const app = express();
app.use(express.json({ limit: '4mb' }));

let clerkAuth: ((req: Request) => { userId: string | null }) | null = null;
if (CLERK_ENABLED) {
  const { clerkMiddleware, getAuth } = await import('@clerk/express');
  // Reuse the frontend's key so .env holds a single publishable key.
  app.use(
    clerkMiddleware({
      publishableKey:
        process.env.CLERK_PUBLISHABLE_KEY || process.env.VITE_CLERK_PUBLISHABLE_KEY,
      secretKey: process.env.CLERK_SECRET_KEY,
    }),
  );
  clerkAuth = (req) => getAuth(req);
}

function userIdOf(req: Request): string | null {
  if (!CLERK_ENABLED) return 'local';
  return clerkAuth!(req).userId;
}

// Every /api route requires an identity; ensure the user row exists so the
// Commons can render members without a separate profile step.
const seenUsers = new Set<string>();
app.use('/api', async (req: Request, res: Response, next: NextFunction) => {
  const userId = userIdOf(req);
  if (!userId) return res.status(401).json({ error: 'Sign in to use Polygon' });
  (req as Request & { userId: string }).userId = userId;
  if (!seenUsers.has(userId)) {
    if (userId === 'local') {
      upsertUser('local', 'You', '');
    } else if (!getUser(userId)) {
      try {
        const { clerkClient } = await import('@clerk/express');
        const u = await clerkClient.users.getUser(userId);
        const name =
          [u.firstName, u.lastName].filter(Boolean).join(' ') ||
          u.username ||
          u.primaryEmailAddress?.emailAddress ||
          'Polymath';
        upsertUser(userId, name, u.imageUrl ?? '');
      } catch {
        upsertUser(userId, 'Polymath', '');
      }
    }
    seenUsers.add(userId);
  }
  next();
});

function uid(req: Request): string {
  return (req as Request & { userId: string }).userId;
}

// Scans are capped per run to bound cost/latency; leftovers are picked up by
// the next scan since scanned_pairs only records what was actually evaluated.
const MAX_PAIRS_PER_SCAN = 60;

app.get('/api/state', (req, res) => {
  const userId = uid(req);
  const openAiApiKey = getUserOpenAiApiKey(userId);
  res.json({
    user: getUser(userId),
    pursuits: listPursuits(userId),
    artifacts: listArtifacts(userId),
    connections: listConnections(userId),
    unscanned_pair_count: unscannedPairs(userId).length,
    llm_configured: llmConfigured(openAiApiKey),
    openai_api_key_configured: userHasOpenAiApiKey(userId),
    server_llm_configured: llmConfigured(),
    clerk_enabled: CLERK_ENABLED,
  });
});

app.put('/api/settings/openai-key', (req, res) => {
  const { api_key } = req.body ?? {};
  if (typeof api_key !== 'string' || !api_key.trim()) {
    return res.status(400).json({ error: 'OpenAI API key is required' });
  }
  const key = api_key.trim();
  if (!key.startsWith('sk-')) {
    return res.status(400).json({ error: 'OpenAI API keys usually start with sk-' });
  }
  updateUserOpenAiApiKey(uid(req), key);
  res.json({ ok: true, openai_api_key_configured: true });
});

app.delete('/api/settings/openai-key', (req, res) => {
  updateUserOpenAiApiKey(uid(req), '');
  res.json({ ok: true, openai_api_key_configured: false });
});

app.post('/api/pursuits', (req, res) => {
  const { name, description = '' } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  try {
    res.status(201).json(createPursuit(uid(req), name, description));
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'A pursuit with that name already exists' });
    }
    throw e;
  }
});

app.put('/api/pursuits/:id', (req, res) => {
  const { name, description = '', is_public = false } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const id = Number(req.params.id);
  if (!pursuitOwnedBy(uid(req), id)) return res.status(404).json({ error: 'Not your pursuit' });
  try {
    const wasPublic = pursuitIsPublic(id);
    updatePursuit(uid(req), id, name, description, Boolean(is_public));
    if (!wasPublic && Boolean(is_public)) {
      emitFeedEvent({ user_id: uid(req), kind: 'pursuit_public', ref_id: id });
    }
    res.json({ ok: true });
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'A pursuit with that name already exists' });
    }
    throw e;
  }
});

app.delete('/api/pursuits/:id', (req, res) => {
  deletePursuit(uid(req), Number(req.params.id));
  res.json({ ok: true });
});

const KINDS = new Set(['note', 'code', 'image', 'puzzle']);

app.post('/api/artifacts', (req, res) => {
  const { pursuit_id, kind, title, content = '' } = req.body ?? {};
  if (!Number.isInteger(pursuit_id)) return res.status(400).json({ error: 'pursuit_id is required' });
  if (!KINDS.has(kind)) return res.status(400).json({ error: 'kind must be note|code|image|puzzle' });
  if (typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: 'title is required' });
  if (!pursuitOwnedBy(uid(req), pursuit_id)) return res.status(404).json({ error: 'Not your pursuit' });
  const artifact = createArtifact(pursuit_id, kind, title, String(content));
  emitFeedEvent({ user_id: uid(req), kind: 'artifact', ref_id: artifact.id });
  res.status(201).json(artifact);
});

app.put('/api/artifacts/:id', (req, res) => {
  const { kind, title, content = '' } = req.body ?? {};
  if (!KINDS.has(kind)) return res.status(400).json({ error: 'kind must be note|code|image|puzzle' });
  if (typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: 'title is required' });
  const id = Number(req.params.id);
  if (!artifactOwnedBy(uid(req), id)) return res.status(404).json({ error: 'Not your artifact' });
  updateArtifact(id, kind, title, String(content));
  res.json({ ok: true });
});

app.delete('/api/artifacts/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!artifactOwnedBy(uid(req), id)) return res.status(404).json({ error: 'Not your artifact' });
  deleteArtifact(id);
  res.json({ ok: true });
});

// The core loop: evaluate not-yet-scanned pairs, persist both the connections
// found and the fact that each pair was evaluated (so no pair repeats).
app.post('/api/scan', async (req, res) => {
  const userId = uid(req);
  const allPairs = unscannedPairs(userId);
  if (allPairs.length === 0) {
    return res.json({ status: 'empty', connections: [], pairs_scanned: 0, pairs_remaining: 0 });
  }
  const pairs = allPairs.slice(0, MAX_PAIRS_PER_SCAN);
  const involvedIds = new Set(pairs.flat());
  const artifacts = listArtifacts(userId)
    .filter((a) => involvedIds.has(a.id))
    .map(
      (a): ArtifactForScan => ({
        id: a.id,
        pursuit: a.pursuit_name ?? '',
        kind: a.kind,
        title: a.title,
        content: a.content,
      }),
    );
  try {
    const found = await findConnections(artifacts, pairs, {
      openAiApiKey: getUserOpenAiApiKey(userId),
    });
    const connectionIds = recordScanResults(pairs, found);
    for (const id of connectionIds) {
      emitFeedEvent({ user_id: userId, kind: 'connection', ref_id: id });
    }
    res.json({
      status: found.length > 0 ? 'found' : 'none_found',
      connections: listConnections(userId),
      pairs_scanned: pairs.length,
      pairs_remaining: allPairs.length - pairs.length,
    });
  } catch (e: unknown) {
    // Transient failure: nothing is recorded, so the same pairs are retried
    // next scan. UI copy distinguishes "scan failed" from "nothing found".
    if (e instanceof LlmNotConfiguredError) {
      return res.status(503).json({ status: 'not_configured', error: e.message });
    }
    const message = e instanceof Error ? e.message : 'Unknown error';
    res.status(502).json({ status: 'failed', error: message });
  }
});

app.delete('/api/connections/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!connectionOwnedBy(uid(req), id)) return res.status(404).json({ error: 'Not your connection' });
  deleteConnection(id);
  res.json({ ok: true });
});

// ── Community ──────────────────────────────────────────

app.get('/api/community', (_req, res) => {
  res.json({ members: communityMembers(), feed: publicConnections() });
});

// ── Social module (the Atlas) ──────────────────────────
// One mount line. Removing it (and the import) restores a fully functional
// core app — the module-removal test from the design doc.
app.use('/api/social', socialRouter);

// ── Export / import ────────────────────────────────────

app.get('/api/export', (req, res) => {
  const buf = exportUserDb(uid(req));
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('content-type', 'application/octet-stream');
  res.setHeader('content-disposition', `attachment; filename="polygon-${stamp}.db"`);
  res.send(buf);
});

const SQLITE_MAGIC = 'SQLite format 3 ';

app.post(
  '/api/import',
  express.raw({ type: () => true, limit: '256mb' }),
  (req, res) => {
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length < 100) {
      return res.status(400).json({ error: 'Empty upload — pick a .db file exported by Polygon' });
    }
    if (body.subarray(0, 16).toString('utf8') !== SQLITE_MAGIC) {
      return res.status(400).json({ error: 'Not a SQLite database file' });
    }
    // better-sqlite3 opens files, not buffers — stage the upload in a temp dir.
    const dir = mkdtempSync(join(tmpdir(), 'polygon-import-'));
    const tmpPath = join(dir, 'upload.db');
    let source: Database.Database | null = null;
    try {
      writeFileSync(tmpPath, body);
      source = new Database(tmpPath, { readonly: true, fileMustExist: true });
      const tables = new Set(
        (source.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as {
          name: string;
        }[]).map((t) => t.name),
      );
      for (const required of ['pursuits', 'artifacts', 'connections', 'scanned_pairs']) {
        if (!tables.has(required)) {
          return res.status(400).json({ error: `Missing table "${required}" — not a Polygon export` });
        }
      }
      const counts = importUserDb(uid(req), source);
      res.json({ ok: true, ...counts });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Import failed';
      res.status(400).json({ error: message });
    } finally {
      source?.close();
      try {
        unlinkSync(tmpPath);
      } catch {
        /* temp dir cleanup is best-effort */
      }
    }
  },
);

// Production: serve the built frontend from dist/.
if (process.env.NODE_ENV === 'production') {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const dist = join(root, 'dist');
  app.use(express.static(dist));
  app.get('{*splat}', (_req, res) => res.sendFile(join(dist, 'index.html')));
}

const PORT = Number(process.env.PORT || 3141);
app.listen(PORT, () => {
  console.log(
    `Polygon server on http://localhost:${PORT} (server llm ${llmConfigured() ? 'configured' : 'NOT configured'}, auth ${CLERK_ENABLED ? 'clerk' : 'solo mode'})`,
  );
});
