// The core→social boundary. Core routes emit feed events through this no-op
// emitter; the social module registers a listener when (and only when) it is
// mounted. Core NEVER imports from server/social/ — removing the social module
// makes every emit an awaited no-op, which is the design's removal test.
//
// emit is async and awaited by routes so the feed write completes before the
// HTTP response — required on serverless, where the instance may freeze the
// moment the response is sent.

export type FeedEventKind = 'artifact' | 'connection' | 'pursuit_public';

export interface FeedEventInput {
  user_id: string;
  kind: FeedEventKind;
  ref_id: number;
}

type Listener = (e: FeedEventInput) => void | Promise<void>;

const listeners: Listener[] = [];

export function registerFeedListener(fn: Listener): void {
  listeners.push(fn);
}

export async function emitFeedEvent(e: FeedEventInput): Promise<void> {
  for (const fn of listeners) {
    try {
      await fn(e);
    } catch {
      // A social-layer failure must never break a core write.
    }
  }
}
