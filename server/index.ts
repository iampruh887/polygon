import express from 'express';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  listPursuits,
  createPursuit,
  updatePursuit,
  deletePursuit,
  listArtifacts,
  createArtifact,
  updateArtifact,
  deleteArtifact,
  listConnections,
  unscannedPairs,
  recordScanResults,
  db,
} from './db';
import { findConnections, llmConfigured, LlmNotConfiguredError, type ArtifactForScan } from './llm';

const app = express();
app.use(express.json({ limit: '4mb' }));

// Scans are capped per run to bound cost/latency; leftovers are picked up by
// the next scan since scanned_pairs only records what was actually evaluated.
const MAX_PAIRS_PER_SCAN = 60;

app.get('/api/state', (_req, res) => {
  res.json({
    pursuits: listPursuits(),
    artifacts: listArtifacts(),
    connections: listConnections(),
    unscanned_pair_count: unscannedPairs().length,
    llm_configured: llmConfigured(),
  });
});

app.post('/api/pursuits', (req, res) => {
  const { name, description = '' } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  try {
    res.status(201).json(createPursuit(name, description));
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'A pursuit with that name already exists' });
    }
    throw e;
  }
});

app.put('/api/pursuits/:id', (req, res) => {
  const { name, description = '' } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  updatePursuit(Number(req.params.id), name, description);
  res.json({ ok: true });
});

app.delete('/api/pursuits/:id', (req, res) => {
  deletePursuit(Number(req.params.id));
  res.json({ ok: true });
});

const KINDS = new Set(['note', 'code', 'image', 'puzzle']);

app.post('/api/artifacts', (req, res) => {
  const { pursuit_id, kind, title, content = '' } = req.body ?? {};
  if (!Number.isInteger(pursuit_id)) return res.status(400).json({ error: 'pursuit_id is required' });
  if (!KINDS.has(kind)) return res.status(400).json({ error: 'kind must be note|code|image|puzzle' });
  if (typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: 'title is required' });
  res.status(201).json(createArtifact(pursuit_id, kind, title, String(content)));
});

app.put('/api/artifacts/:id', (req, res) => {
  const { kind, title, content = '' } = req.body ?? {};
  if (!KINDS.has(kind)) return res.status(400).json({ error: 'kind must be note|code|image|puzzle' });
  if (typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: 'title is required' });
  updateArtifact(Number(req.params.id), kind, title, String(content));
  res.json({ ok: true });
});

app.delete('/api/artifacts/:id', (req, res) => {
  deleteArtifact(Number(req.params.id));
  res.json({ ok: true });
});

// The core loop: evaluate not-yet-scanned pairs, persist both the connections
// found and the fact that each pair was evaluated (so no pair repeats).
app.post('/api/scan', async (_req, res) => {
  const allPairs = unscannedPairs();
  if (allPairs.length === 0) {
    return res.json({ status: 'empty', connections: [], pairs_scanned: 0, pairs_remaining: 0 });
  }
  const pairs = allPairs.slice(0, MAX_PAIRS_PER_SCAN);
  const involvedIds = new Set(pairs.flat());
  const artifacts = listArtifacts()
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
    const found = await findConnections(artifacts, pairs);
    recordScanResults(pairs, found);
    res.json({
      status: found.length > 0 ? 'found' : 'none_found',
      connections: listConnections(),
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
  db.prepare('DELETE FROM connections WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// Production: serve the built frontend from dist/.
if (process.env.NODE_ENV === 'production') {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const dist = join(root, 'dist');
  app.use(express.static(dist));
  app.get('{*splat}', (_req, res) => res.sendFile(join(dist, 'index.html')));
}

const PORT = Number(process.env.PORT || 3141);
app.listen(PORT, () => {
  console.log(`Polygon server on http://localhost:${PORT} (llm ${llmConfigured() ? 'configured' : 'NOT configured'})`);
});
