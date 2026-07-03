import 'dotenv/config';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
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
  pursuitIsPublic,
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
  exportUserJson,
  importUserJson,
  createFeedback,
  query,
  type UserExport,
} from './db.js';
import { notifyTelegram, escapeHtml } from './telegram.js';
import { findConnections, llmConfigured, LlmNotConfiguredError, type ArtifactForScan } from './llm.js';
import { emitFeedEvent } from './events.js';
import { socialRouter } from './social/index.js';

const CLERK_ENABLED = Boolean(process.env.CLERK_SECRET_KEY);
const ON_VERCEL = Boolean(process.env.VERCEL);
const MAX_PAIRS_PER_SCAN = 60;

// Build the Express app. Async because Clerk middleware is imported lazily.
// Both the local dev server (index.ts) and the Vercel function (api/[...path])
// call this; nothing else differs between them.
export async function buildApp(): Promise<Express> {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  // Unauthenticated liveness + DB reachability. Mounted before the auth gate so
  // it works without a session — for uptime checks and deploy verification.
  app.get('/api/health', async (_req, res) => {
    try {
      await query('SELECT 1');
      res.json({ ok: true, db: 'up', clerk: CLERK_ENABLED, vercel: ON_VERCEL });
    } catch (e) {
      res.status(503).json({ ok: false, db: 'down', error: e instanceof Error ? e.message : 'db error' });
    }
  });

  let clerkAuth: ((req: Request) => { userId: string | null }) | null = null;
  if (CLERK_ENABLED) {
    const { clerkMiddleware, getAuth } = await import('@clerk/express');
    app.use(
      clerkMiddleware({
        publishableKey: process.env.CLERK_PUBLISHABLE_KEY || process.env.VITE_CLERK_PUBLISHABLE_KEY,
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
  // Commons/Atlas can render members without a separate profile step.
  app.use('/api', async (req: Request, res: Response, next: NextFunction) => {
    const userId = userIdOf(req);
    if (!userId) return res.status(401).json({ error: 'Sign in to use Polygon' });
    (req as Request & { userId: string }).userId = userId;
    try {
      if (userId === 'local') {
        if (!(await getUser('local'))) await upsertUser('local', 'You', '');
      } else if (!(await getUser(userId))) {
        try {
          const { clerkClient } = await import('@clerk/express');
          const u = await clerkClient.users.getUser(userId);
          const name =
            [u.firstName, u.lastName].filter(Boolean).join(' ') ||
            u.username ||
            u.primaryEmailAddress?.emailAddress ||
            'Polymath';
          await upsertUser(userId, name, u.imageUrl ?? '');
        } catch {
          await upsertUser(userId, 'Polymath', '');
        }
      }
    } catch (e) {
      return next(e);
    }
    next();
  });

  function uid(req: Request): string {
    return (req as Request & { userId: string }).userId;
  }

  app.get('/api/state', async (req, res) => {
    const userId = uid(req);
    const [user, pursuits, artifacts, connections, pairs, openAiApiKey, hasKey] = await Promise.all([
      getUser(userId),
      listPursuits(userId),
      listArtifacts(userId),
      listConnections(userId),
      unscannedPairs(userId),
      getUserOpenAiApiKey(userId),
      userHasOpenAiApiKey(userId),
    ]);
    res.json({
      user,
      pursuits,
      artifacts,
      connections,
      unscanned_pair_count: pairs.length,
      llm_configured: llmConfigured(openAiApiKey),
      openai_api_key_configured: hasKey,
      server_llm_configured: llmConfigured(),
      clerk_enabled: CLERK_ENABLED,
      sse_enabled: !ON_VERCEL,
    });
  });

  // Per-user OpenAI key (bring-your-own): stored server-side, never echoed back.
  app.put('/api/settings/openai-key', async (req, res) => {
    const { api_key } = req.body ?? {};
    if (typeof api_key !== 'string' || !api_key.trim()) {
      return res.status(400).json({ error: 'OpenAI API key is required' });
    }
    const key = api_key.trim();
    if (!key.startsWith('sk-')) {
      return res.status(400).json({ error: 'OpenAI API keys usually start with sk-' });
    }
    await updateUserOpenAiApiKey(uid(req), key);
    res.json({ ok: true, openai_api_key_configured: true });
  });

  app.delete('/api/settings/openai-key', async (req, res) => {
    await updateUserOpenAiApiKey(uid(req), '');
    res.json({ ok: true, openai_api_key_configured: false });
  });

  app.post('/api/pursuits', async (req, res) => {
    const { name, description = '' } = req.body ?? {};
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    try {
      res.status(201).json(await createPursuit(uid(req), name, description));
    } catch (e: unknown) {
      if (e instanceof Error && /unique|duplicate/i.test(e.message)) {
        return res.status(409).json({ error: 'A pursuit with that name already exists' });
      }
      throw e;
    }
  });

  app.put('/api/pursuits/:id', async (req, res) => {
    const { name, description = '', is_public = false } = req.body ?? {};
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    const id = Number(req.params.id);
    if (!(await pursuitOwnedBy(uid(req), id))) return res.status(404).json({ error: 'Not your pursuit' });
    try {
      const wasPublic = await pursuitIsPublic(id);
      await updatePursuit(uid(req), id, name, description, Boolean(is_public));
      if (!wasPublic && Boolean(is_public)) {
        await emitFeedEvent({ user_id: uid(req), kind: 'pursuit_public', ref_id: id });
      }
      res.json({ ok: true });
    } catch (e: unknown) {
      if (e instanceof Error && /unique|duplicate/i.test(e.message)) {
        return res.status(409).json({ error: 'A pursuit with that name already exists' });
      }
      throw e;
    }
  });

  app.delete('/api/pursuits/:id', async (req, res) => {
    await deletePursuit(uid(req), Number(req.params.id));
    res.json({ ok: true });
  });

  const KINDS = new Set(['note', 'code', 'image', 'puzzle']);

  app.post('/api/artifacts', async (req, res) => {
    const { pursuit_id, kind, title, content = '' } = req.body ?? {};
    if (!Number.isInteger(pursuit_id)) return res.status(400).json({ error: 'pursuit_id is required' });
    if (!KINDS.has(kind)) return res.status(400).json({ error: 'kind must be note|code|image|puzzle' });
    if (typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: 'title is required' });
    if (!(await pursuitOwnedBy(uid(req), pursuit_id))) return res.status(404).json({ error: 'Not your pursuit' });
    const artifact = await createArtifact(pursuit_id, kind, title, String(content));
    await emitFeedEvent({ user_id: uid(req), kind: 'artifact', ref_id: artifact.id });
    res.status(201).json(artifact);
  });

  app.put('/api/artifacts/:id', async (req, res) => {
    const { kind, title, content = '' } = req.body ?? {};
    if (!KINDS.has(kind)) return res.status(400).json({ error: 'kind must be note|code|image|puzzle' });
    if (typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: 'title is required' });
    const id = Number(req.params.id);
    if (!(await artifactOwnedBy(uid(req), id))) return res.status(404).json({ error: 'Not your artifact' });
    await updateArtifact(id, kind, title, String(content));
    res.json({ ok: true });
  });

  app.delete('/api/artifacts/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!(await artifactOwnedBy(uid(req), id))) return res.status(404).json({ error: 'Not your artifact' });
    await deleteArtifact(id);
    res.json({ ok: true });
  });

  // The core loop: evaluate not-yet-scanned pairs, persist connections found
  // and the fact that each pair was evaluated (so no pair repeats).
  app.post('/api/scan', async (req, res) => {
    const userId = uid(req);
    const allPairs = await unscannedPairs(userId);
    if (allPairs.length === 0) {
      return res.json({ status: 'empty', connections: [], pairs_scanned: 0, pairs_remaining: 0 });
    }
    const pairs = allPairs.slice(0, MAX_PAIRS_PER_SCAN);
    const involvedIds = new Set(pairs.flat());
    const artifacts = (await listArtifacts(userId))
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
        openAiApiKey: await getUserOpenAiApiKey(userId),
      });
      const connectionIds = await recordScanResults(pairs, found);
      for (const id of connectionIds) {
        await emitFeedEvent({ user_id: userId, kind: 'connection', ref_id: id });
      }
      res.json({
        status: found.length > 0 ? 'found' : 'none_found',
        connections: await listConnections(userId),
        pairs_scanned: pairs.length,
        pairs_remaining: allPairs.length - pairs.length,
      });
    } catch (e: unknown) {
      if (e instanceof LlmNotConfiguredError) {
        return res.status(503).json({ status: 'not_configured', error: e.message });
      }
      const message = e instanceof Error ? e.message : 'Unknown error';
      res.status(502).json({ status: 'failed', error: message });
    }
  });

  app.delete('/api/connections/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!(await connectionOwnedBy(uid(req), id))) return res.status(404).json({ error: 'Not your connection' });
    await deleteConnection(id);
    res.json({ ok: true });
  });

  app.get('/api/community', async (_req, res) => {
    const [members, feed] = await Promise.all([communityMembers(), publicConnections()]);
    res.json({ members, feed });
  });

  // ── Feedback ─────────────────────────────────────────
  // Stores every submission and (if configured) pings Telegram. A Telegram
  // failure never fails the user's submit; the row is committed first.
  const FEEDBACK_CATEGORIES = new Set(['bug', 'idea', 'other']);

  app.post('/api/feedback', async (req, res) => {
    const userId = uid(req);
    const { category, rating, message } = req.body ?? {};
    if (!FEEDBACK_CATEGORIES.has(category)) {
      return res.status(400).json({ error: 'category must be bug, idea, or other' });
    }
    const r = Number(rating);
    if (!Number.isInteger(r) || r < 1 || r > 5) {
      return res.status(400).json({ error: 'rating must be an integer 1–5' });
    }
    const text = typeof message === 'string' ? message.trim() : '';
    if (!text) return res.status(400).json({ error: 'message is required' });
    if (text.length > 4000) return res.status(400).json({ error: 'message is too long (max 4000 chars)' });

    // Identity: users table has no email column — display name comes from it,
    // the real email is fetched live from Clerk (best-effort).
    const user = await getUser(userId);
    const display_name = user?.name ?? (userId === 'local' ? 'You' : 'Polymath');
    let email = '';
    if (CLERK_ENABLED && userId !== 'local') {
      try {
        const { clerkClient } = await import('@clerk/express');
        const u = await clerkClient.users.getUser(userId);
        email = u.primaryEmailAddress?.emailAddress ?? '';
      } catch {
        /* email stays '' — never block feedback on a Clerk lookup */
      }
    }

    await createFeedback({ user_id: userId, email, display_name, category, rating: r, message: text });

    const stars = '★'.repeat(r) + '☆'.repeat(5 - r);
    const who = email ? `${display_name} (${email})` : `${display_name} [${userId}]`;
    await notifyTelegram(
      `<b>Polygon feedback</b> — ${escapeHtml(category)} ${stars}\n` +
        `${escapeHtml(text)}\n\n` +
        `<i>${escapeHtml(who)}</i>`,
    );

    res.status(201).json({ ok: true });
  });

  // Social module (the Atlas). One mount line — removing it and the import
  // restores a fully functional core app (the module-removal test).
  app.use('/api/social', socialRouter);

  // ── Export / import (JSON) ───────────────────────────

  app.get('/api/export', async (req, res) => {
    const data = await exportUserJson(uid(req));
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('content-type', 'application/json');
    res.setHeader('content-disposition', `attachment; filename="polygon-${stamp}.json"`);
    res.send(JSON.stringify(data, null, 2));
  });

  app.post('/api/import', async (req, res) => {
    const data = req.body as UserExport;
    if (!data || data.format !== 'polygon-export' || !Array.isArray(data.pursuits)) {
      return res.status(400).json({ error: 'Not a Polygon export file' });
    }
    try {
      const counts = await importUserJson(uid(req), data);
      res.json({ ok: true, ...counts });
    } catch (e: unknown) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Import failed' });
    }
  });

  // Error handler — surfaces DB failures as JSON instead of a hung request.
  app.use('/api', (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : 'Server error';
    if (!res.headersSent) res.status(500).json({ error: message });
  });

  return app;
}
