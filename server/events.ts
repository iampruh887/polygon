// The core→social boundary. Core routes emit feed events through this no-op
// emitter; the social module registers a listener when (and only when) it is
// mounted. Core NEVER imports from server/social/ — removing the social module
// turns every emit into a no-op, which is exactly the design's removal test.

export type FeedEventKind = 'artifact' | 'connection' | 'pursuit_public';

export interface FeedEventInput {
  user_id: string;
  kind: FeedEventKind;
  ref_id: number;
}

type Listener = (e: FeedEventInput) => void;

const listeners: Listener[] = [];

export function registerFeedListener(fn: Listener): void {
  listeners.push(fn);
}

export function emitFeedEvent(e: FeedEventInput): void {
  for (const fn of listeners) {
    try {
      fn(e);
    } catch {
      // A social-layer failure must never break a core write.
    }
  }
}
