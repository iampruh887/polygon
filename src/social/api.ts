import { useEffect, useRef } from 'react';
import type { AtlasNode, FeedItem, PursuitDetail, ProfileDetail } from './types';

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { 'content-type': 'application/json' }, ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

export const socialApi = {
  atlas: () => req<{ nodes: AtlasNode[]; total: number }>('/api/social/atlas'),
  feed: (before?: number) =>
    req<{ items: FeedItem[] }>(`/api/social/feed${before ? `?before=${before}` : ''}`),
  pursuit: (norm: string) => req<PursuitDetail>(`/api/social/pursuit/${encodeURIComponent(norm)}`),
  profile: (userId: string) => req<ProfileDetail>(`/api/social/profile/${encodeURIComponent(userId)}`),
  follow: (userId: string) => req(`/api/social/follows/${encodeURIComponent(userId)}`, { method: 'POST' }),
  unfollow: (userId: string) =>
    req(`/api/social/follows/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
  report: (subject_kind: string, subject_id: string | number, reason: string) =>
    req('/api/social/reports', {
      method: 'POST',
      body: JSON.stringify({ subject_kind, subject_id, reason }),
    }),
};

// Hidden users: client-side, localStorage, V1 (per design doc).
const HIDE_KEY = 'polygon-hidden-users';

export function hiddenUsers(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(HIDE_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

export function toggleHidden(userId: string): Set<string> {
  const set = hiddenUsers();
  if (set.has(userId)) set.delete(userId);
  else set.add(userId);
  localStorage.setItem(HIDE_KEY, JSON.stringify([...set]));
  return set;
}

/**
 * Keeps the feed fresh. Polling is the always-on floor (works on Vercel
 * serverless, where SSE can't). When the server advertises sse_enabled (a
 * long-running local/self-host server), SSE is layered on for near-instant
 * updates. onTick fires whenever the feed may have changed.
 */
export function useLiveTick(onTick: () => void, sseEnabled: boolean): void {
  const cb = useRef(onTick);
  cb.current = onTick;
  useEffect(() => {
    // Poll floor — always on.
    const poll = setInterval(() => cb.current(), 10_000);
    let es: EventSource | null = null;
    if (sseEnabled) {
      try {
        es = new EventSource('/api/social/stream');
        es.onmessage = () => cb.current();
        // On error EventSource auto-reconnects; polling already covers the gap.
      } catch {
        /* polling floor covers it */
      }
    }
    return () => {
      es?.close();
      clearInterval(poll);
    };
  }, [sseEnabled]);
}
