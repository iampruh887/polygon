// Social module data layer. Owns its three tables; imports the core db handle
// but the core never imports this file. Feed storage is append-only — deletion
// and privacy are enforced by filter-on-read joins against live rows.
import { db } from '../db';
import type { FeedEventInput } from '../events';

db.exec(`
  CREATE TABLE IF NOT EXISTS follows (
    follower_id TEXT NOT NULL,
    followee_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (follower_id, followee_id)
  );

  CREATE TABLE IF NOT EXISTS feed_events (
    id INTEGER PRIMARY KEY,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('artifact', 'connection', 'pursuit_public')),
    ref_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY,
    reporter_id TEXT NOT NULL,
    subject_kind TEXT NOT NULL CHECK (subject_kind IN ('user', 'artifact', 'pursuit', 'connection')),
    subject_id TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_feed_events_time ON feed_events(id DESC);
  CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows(followee_id);
`);

// One normalization function, used everywhere pursuit names are compared.
export function normalizePursuit(name: string): string {
  return name.trim().toLowerCase();
}

export function insertFeedEvent(e: FeedEventInput): number {
  const info = db
    .prepare('INSERT INTO feed_events (user_id, kind, ref_id) VALUES (?, ?, ?)')
    .run(e.user_id, e.kind, e.ref_id);
  return Number(info.lastInsertRowid);
}

// ── Feed hydration (filter-on-read) ────────────────────

export interface FeedItem {
  event_id: number;
  kind: string;
  created_at: string;
  user: { id: string; name: string; image_url: string };
  artifact?: { id: number; title: string; kind: string; snippet: string; pursuit_name: string };
  connection?: {
    id: number;
    a_title: string;
    b_title: string;
    a_pursuit: string;
    b_pursuit: string;
    explanation_text: string;
  };
  pursuit?: { id: number; name: string; description: string };
}

const hydrateArtifact = db.prepare(`
  SELECT a.id, a.title, a.kind, substr(a.content, 1, 280) AS snippet, p.name AS pursuit_name
  FROM artifacts a JOIN pursuits p ON p.id = a.pursuit_id
  WHERE a.id = ? AND p.is_public = 1
`);

const hydrateConnection = db.prepare(`
  SELECT c.id, aa.title AS a_title, ab.title AS b_title,
         pa.name AS a_pursuit, pb.name AS b_pursuit, c.explanation_text
  FROM connections c
  JOIN artifacts aa ON aa.id = c.artifact_a_id
  JOIN artifacts ab ON ab.id = c.artifact_b_id
  JOIN pursuits pa ON pa.id = aa.pursuit_id
  JOIN pursuits pb ON pb.id = ab.pursuit_id
  WHERE c.id = ? AND pa.is_public = 1 AND pb.is_public = 1
`);

const hydratePursuit = db.prepare(`
  SELECT id, name, description FROM pursuits WHERE id = ? AND is_public = 1
`);

export function feedPage(beforeId: number | null, limit = 30): FeedItem[] {
  const rows = db
    .prepare(
      `SELECT e.id AS event_id, e.kind, e.created_at, e.ref_id,
              u.id AS uid, u.name AS uname, u.image_url AS uimage
       FROM feed_events e JOIN users u ON u.id = e.user_id
       WHERE (? IS NULL OR e.id < ?)
       ORDER BY e.id DESC
       LIMIT ?`,
    )
    // Over-fetch: some events hydrate to nothing (deleted or private referents).
    .all(beforeId, beforeId, limit * 3) as {
    event_id: number;
    kind: string;
    created_at: string;
    ref_id: number;
    uid: string;
    uname: string;
    uimage: string;
  }[];

  const items: FeedItem[] = [];
  for (const r of rows) {
    if (items.length >= limit) break;
    const base: FeedItem = {
      event_id: r.event_id,
      kind: r.kind,
      created_at: r.created_at,
      user: { id: r.uid, name: r.uname, image_url: r.uimage },
    };
    if (r.kind === 'artifact') {
      const a = hydrateArtifact.get(r.ref_id) as FeedItem['artifact'] | undefined;
      if (!a) continue;
      base.artifact = a;
    } else if (r.kind === 'connection') {
      const c = hydrateConnection.get(r.ref_id) as FeedItem['connection'] | undefined;
      if (!c) continue;
      base.connection = c;
    } else {
      const p = hydratePursuit.get(r.ref_id) as FeedItem['pursuit'] | undefined;
      if (!p) continue;
      base.pursuit = p;
    }
    items.push(base);
  }
  return items;
}

// ── Atlas ──────────────────────────────────────────────

export interface AtlasNode {
  norm: string;
  display_name: string;
  member_count: number;
  active24h: number;
  events30d: number;
}

export function atlasNodes(cap = 150): { nodes: AtlasNode[]; total: number } {
  // Public pursuits merged by normalized name; activity from feed_events with
  // the same live-row filter the feed uses (ranking query, premise-consistent).
  const nodes = db
    .prepare(
      `WITH pub AS (
         SELECT p.id, p.user_id, p.name, lower(trim(p.name)) AS norm
         FROM pursuits p WHERE p.is_public = 1
       ),
       act AS (
         SELECT lower(trim(p.name)) AS norm,
                COUNT(*) AS events30d,
                SUM(CASE WHEN e.created_at >= datetime('now', '-1 day') THEN 1 ELSE 0 END) AS active24h
         FROM feed_events e
         JOIN artifacts a ON e.kind = 'artifact' AND a.id = e.ref_id
         JOIN pursuits p ON p.id = a.pursuit_id AND p.is_public = 1
         WHERE e.created_at >= datetime('now', '-30 day')
         GROUP BY norm
       )
       SELECT pub.norm,
              MIN(pub.name) AS display_name,
              COUNT(DISTINCT pub.user_id) AS member_count,
              COALESCE(MAX(act.active24h), 0) AS active24h,
              COALESCE(MAX(act.events30d), 0) AS events30d
       FROM pub LEFT JOIN act ON act.norm = pub.norm
       GROUP BY pub.norm
       ORDER BY events30d DESC, member_count DESC, pub.norm ASC`,
    )
    .all() as AtlasNode[];
  return { nodes: nodes.slice(0, cap), total: nodes.length };
}

// ── People & overlap ───────────────────────────────────

/** Viewer's own pursuits (public AND private) count toward overlap; only the
    other person's public pursuits are visible or counted for display. */
export function overlapScore(viewerId: string, targetId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT lower(trim(mine.name))) AS score
       FROM pursuits mine
       JOIN pursuits theirs
         ON lower(trim(theirs.name)) = lower(trim(mine.name))
        AND theirs.user_id = ? AND theirs.is_public = 1
       WHERE mine.user_id = ?`,
    )
    .get(targetId, viewerId) as { score: number };
  return row.score;
}

export interface PursuitMember {
  id: string;
  name: string;
  image_url: string;
  public_artifacts: number;
  overlap: number;
  is_following: boolean;
}

export function pursuitDetail(norm: string, viewerId: string) {
  const members = db
    .prepare(
      `SELECT u.id, u.name, u.image_url,
              (SELECT COUNT(*) FROM artifacts a2 JOIN pursuits p2 ON p2.id = a2.pursuit_id
                WHERE p2.user_id = u.id AND p2.is_public = 1) AS public_artifacts
       FROM pursuits p JOIN users u ON u.id = p.user_id
       WHERE p.is_public = 1 AND lower(trim(p.name)) = ?
       GROUP BY u.id
       ORDER BY public_artifacts DESC`,
    )
    .all(norm) as Omit<PursuitMember, 'overlap' | 'is_following'>[];
  const isFollowing = db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?');
  const withScores: PursuitMember[] = members.map((m) => ({
    ...m,
    overlap: overlapScore(viewerId, m.id),
    is_following: Boolean(isFollowing.get(viewerId, m.id)),
  }));
  const artifacts = db
    .prepare(
      `SELECT a.id, a.title, a.kind, substr(a.content, 1, 200) AS snippet,
              a.created_at, u.name AS owner_name, u.id AS owner_id
       FROM artifacts a
       JOIN pursuits p ON p.id = a.pursuit_id AND p.is_public = 1
       JOIN users u ON u.id = p.user_id
       WHERE lower(trim(p.name)) = ?
       ORDER BY a.created_at DESC, a.id DESC LIMIT 20`,
    )
    .all(norm);
  return { members: withScores, artifacts };
}

export function profileDetail(targetId: string, viewerId: string) {
  const user = db
    .prepare('SELECT id, name, image_url FROM users WHERE id = ?')
    .get(targetId) as { id: string; name: string; image_url: string } | undefined;
  if (!user) return null;
  const pursuits = db
    .prepare(
      `SELECT p.id, p.name, p.description,
              COUNT(a.id) AS artifact_count
       FROM pursuits p LEFT JOIN artifacts a ON a.pursuit_id = p.id
       WHERE p.user_id = ? AND p.is_public = 1
       GROUP BY p.id ORDER BY artifact_count DESC`,
    )
    .all(targetId);
  const artifacts = db
    .prepare(
      `SELECT a.id, a.title, a.kind, substr(a.content, 1, 200) AS snippet,
              a.created_at, p.name AS pursuit_name
       FROM artifacts a JOIN pursuits p ON p.id = a.pursuit_id
       WHERE p.user_id = ? AND p.is_public = 1
       ORDER BY a.created_at DESC, a.id DESC LIMIT 20`,
    )
    .all(targetId);
  const followers = (
    db.prepare('SELECT COUNT(*) AS n FROM follows WHERE followee_id = ?').get(targetId) as {
      n: number;
    }
  ).n;
  const following = (
    db.prepare('SELECT COUNT(*) AS n FROM follows WHERE follower_id = ?').get(targetId) as {
      n: number;
    }
  ).n;
  const is_following = Boolean(
    db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?').get(viewerId, targetId),
  );
  const follows_you = Boolean(
    db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?').get(targetId, viewerId),
  );
  return {
    user,
    pursuits,
    artifacts,
    followers,
    following,
    is_following,
    follows_you,
    overlap: overlapScore(viewerId, targetId),
  };
}

export function follow(followerId: string, followeeId: string): void {
  db.prepare('INSERT OR IGNORE INTO follows (follower_id, followee_id) VALUES (?, ?)').run(
    followerId,
    followeeId,
  );
}

export function unfollow(followerId: string, followeeId: string): void {
  db.prepare('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?').run(
    followerId,
    followeeId,
  );
}

export function createReport(
  reporterId: string,
  subjectKind: string,
  subjectId: string,
  reason: string,
): void {
  db.prepare(
    'INSERT INTO reports (reporter_id, subject_kind, subject_id, reason) VALUES (?, ?, ?, ?)',
  ).run(reporterId, subjectKind, subjectId, reason.slice(0, 1000));
}
