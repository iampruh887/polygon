// The social module: mounted under /api/social (behind the core auth
// middleware). Registers itself on the core's no-op feed emitter at import.
// Core never imports this file — server/index.ts mounts it and nothing else.
import { Router, type Request, type Response } from 'express';
import { registerFeedListener, type FeedEventInput } from '../events';
import {
  insertFeedEvent,
  feedPage,
  atlasNodes,
  pursuitDetail,
  profileDetail,
  follow,
  unfollow,
  createReport,
  normalizePursuit,
} from './db';

function uid(req: Request): string {
  return (req as Request & { userId: string }).userId;
}

// ── SSE fan-out ────────────────────────────────────────
// One stream, two consumers (feed rail + atlas pulses). Clients get a
// lightweight nudge and refetch — no payload synchronization to get wrong.

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

setInterval(() => {
  for (const res of sseClients) {
    try {
      res.write(': ping\n\n');
    } catch {
      sseClients.delete(res);
    }
  }
}, 25_000).unref();

// The module's one listener: persist the event, nudge the clients.
registerFeedListener((e: FeedEventInput) => {
  insertFeedEvent(e);
  broadcast(e.kind);
});

// ── Routes ─────────────────────────────────────────────

export const socialRouter = Router();

socialRouter.get('/feed', (req, res) => {
  const before = req.query.before ? Number(req.query.before) : null;
  res.json({ items: feedPage(Number.isFinite(before as number) ? before : null) });
});

socialRouter.get('/stream', (req, res) => {
  res.setHeader('content-type', 'text/event-stream');
  res.setHeader('cache-control', 'no-cache');
  res.setHeader('x-accel-buffering', 'no'); // disable proxy buffering where honored
  res.flushHeaders();
  res.write(': connected\n\n');
  sseClients.add(res);
  req.on('close', () => {
    sseClients.delete(res);
  });
});

socialRouter.get('/atlas', (_req, res) => {
  res.json(atlasNodes());
});

socialRouter.get('/pursuit/:norm', (req, res) => {
  const norm = normalizePursuit(String(req.params.norm));
  res.json(pursuitDetail(norm, uid(req)));
});

socialRouter.get('/profile/:userId', (req, res) => {
  const detail = profileDetail(String(req.params.userId), uid(req));
  if (!detail) return res.status(404).json({ error: 'No such member' });
  res.json(detail);
});

socialRouter.post('/follows/:userId', (req, res) => {
  const target = String(req.params.userId);
  if (target === uid(req)) return res.status(400).json({ error: 'Following yourself is implicit' });
  follow(uid(req), target);
  res.json({ ok: true });
});

socialRouter.delete('/follows/:userId', (req, res) => {
  unfollow(uid(req), String(req.params.userId));
  res.json({ ok: true });
});

socialRouter.post('/reports', (req, res) => {
  const { subject_kind, subject_id, reason = '' } = req.body ?? {};
  if (!['user', 'artifact', 'pursuit', 'connection'].includes(subject_kind)) {
    return res.status(400).json({ error: 'subject_kind must be user|artifact|pursuit|connection' });
  }
  if (typeof subject_id !== 'string' && typeof subject_id !== 'number') {
    return res.status(400).json({ error: 'subject_id is required' });
  }
  createReport(uid(req), subject_kind, String(subject_id), String(reason));
  res.status(201).json({ ok: true });
});
