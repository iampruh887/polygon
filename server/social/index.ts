// The social module: mounted under /api/social (behind the core auth
// middleware). Registers itself on the core's no-op feed emitter at import.
// Core never imports this file — server/app.ts mounts it and nothing else.
import { Router, type Request, type Response } from 'express';
import { registerFeedListener, type FeedEventInput } from '../events.js';
import {
  insertFeedEvent,
  feedPage,
  publicArtifact,
  atlasNodes,
  pursuitDetail,
  profileDetail,
  follow,
  unfollow,
  createReport,
  normalizePursuit,
} from './db.js';

function uid(req: Request): string {
  return (req as Request & { userId: string }).userId;
}

// SSE fan-out is only useful on a long-running local server. On Vercel
// serverless each request is isolated, so the frontend polls instead (it reads
// sse_enabled from /api/state) and never opens the stream.
const ON_VERCEL = Boolean(process.env.VERCEL);
const sseClients = new Set<Response>();

function broadcast(kind: string): void {
  const payload = `data: {"kind":"${kind}"}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

if (!ON_VERCEL) {
  setInterval(() => {
    for (const res of sseClients) {
      try {
        res.write(': ping\n\n');
      } catch {
        sseClients.delete(res);
      }
    }
  }, 25_000).unref();
}

// The module's one listener: persist the event (awaited), then nudge clients.
registerFeedListener(async (e: FeedEventInput) => {
  await insertFeedEvent(e);
  broadcast(e.kind);
});

export const socialRouter = Router();

socialRouter.get('/feed', async (req, res) => {
  const before = req.query.before ? Number(req.query.before) : null;
  res.json({ items: await feedPage(Number.isFinite(before as number) ? before : null) });
});

socialRouter.get('/stream', (req, res) => {
  if (ON_VERCEL) return res.status(204).end(); // no long-lived connections on serverless
  res.setHeader('content-type', 'text/event-stream');
  res.setHeader('cache-control', 'no-cache');
  res.setHeader('x-accel-buffering', 'no');
  res.flushHeaders();
  res.write(': connected\n\n');
  sseClients.add(res);
  req.on('close', () => {
    sseClients.delete(res);
  });
});

// Full artifact for the expand view. Content is returned for text kinds; for
// images it's dropped (the client loads the picture from /image below) so this
// JSON stays small even when the image is multiple megabytes of base64.
socialRouter.get('/artifact/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Bad artifact id' });
  const a = await publicArtifact(id);
  if (!a) return res.status(404).json({ error: 'No such public artifact' });
  const hasImage = a.kind === 'image' && /^data:image\//.test(a.content);
  res.json({ ...a, content: hasImage ? '' : a.content, has_image: hasImage });
});

// The image bytes for an image artifact, decoded from its data URL. Kept as a
// separate binary endpoint so <img> tags can lazy-load and the browser can
// cache them, instead of inlining base64 into every feed payload.
socialRouter.get('/artifact/:id/image', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).end();
  const a = await publicArtifact(id);
  const m = a && a.kind === 'image' ? /^data:([\w/+.-]+);base64,(.*)$/s.exec(a.content) : null;
  if (!m) return res.status(404).end();
  res.setHeader('content-type', m[1]);
  res.setHeader('cache-control', 'public, max-age=3600');
  res.send(Buffer.from(m[2], 'base64'));
});

socialRouter.get('/atlas', async (_req, res) => {
  res.json(await atlasNodes());
});

socialRouter.get('/pursuit/:norm', async (req, res) => {
  const norm = normalizePursuit(String(req.params.norm));
  res.json(await pursuitDetail(norm, uid(req)));
});

socialRouter.get('/profile/:userId', async (req, res) => {
  const detail = await profileDetail(String(req.params.userId), uid(req));
  if (!detail) return res.status(404).json({ error: 'No such member' });
  res.json(detail);
});

socialRouter.post('/follows/:userId', async (req, res) => {
  const target = String(req.params.userId);
  if (target === uid(req)) return res.status(400).json({ error: 'Following yourself is implicit' });
  await follow(uid(req), target);
  res.json({ ok: true });
});

socialRouter.delete('/follows/:userId', async (req, res) => {
  await unfollow(uid(req), String(req.params.userId));
  res.json({ ok: true });
});

socialRouter.post('/reports', async (req, res) => {
  const { subject_kind, subject_id, reason = '' } = req.body ?? {};
  if (!['user', 'artifact', 'pursuit', 'connection'].includes(subject_kind)) {
    return res.status(400).json({ error: 'subject_kind must be user|artifact|pursuit|connection' });
  }
  if (typeof subject_id !== 'string' && typeof subject_id !== 'number') {
    return res.status(400).json({ error: 'subject_id is required' });
  }
  await createReport(uid(req), subject_kind, String(subject_id), String(reason));
  res.status(201).json({ ok: true });
});
