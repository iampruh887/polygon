// Social module data layer, Postgres. Uses the shared pool from ../pg; core
// never imports this file. Feed storage is append-only — deletion and privacy
// are enforced by filter-on-read joins against live rows.
import { query, tsCol, tx } from '../pg.js';
import type { FeedEventInput } from '../events.js';

// One normalization function, used everywhere pursuit names are compared.
export function normalizePursuit(name: string): string {
  return name.trim().toLowerCase();
}

export async function insertFeedEvent(e: FeedEventInput): Promise<number> {
  const { rows } = await query<{ id: number }>(
    'INSERT INTO feed_events (user_id, kind, ref_id) VALUES ($1, $2, $3) RETURNING id',
    [e.user_id, e.kind, e.ref_id],
  );
  return rows[0].id;
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

export async function feedPage(beforeId: number | null, limit = 30): Promise<FeedItem[]> {
  // Over-fetch: some events hydrate to nothing (deleted or private referents).
  const { rows } = await query<{
    event_id: number;
    kind: string;
    created_at: string;
    ref_id: number;
    uid: string;
    uname: string;
    uimage: string;
  }>(
    `SELECT e.id AS event_id, e.kind, ${tsCol('e.created_at', 'created_at')}, e.ref_id,
            u.id AS uid, u.name AS uname, u.image_url AS uimage
     FROM feed_events e JOIN users u ON u.id = e.user_id
     WHERE ($1::int IS NULL OR e.id < $1)
     ORDER BY e.id DESC
     LIMIT $2`,
    [beforeId, limit * 3],
  );

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
      const { rows: a } = await query<FeedItem['artifact']>(
        `SELECT a.id, a.title, a.kind, substr(a.content, 1, 280) AS snippet, p.name AS pursuit_name
         FROM artifacts a JOIN pursuits p ON p.id = a.pursuit_id
         WHERE a.id = $1 AND p.is_public = 1`,
        [r.ref_id],
      );
      if (!a[0]) continue;
      base.artifact = a[0];
    } else if (r.kind === 'connection') {
      const { rows: c } = await query<FeedItem['connection']>(
        `SELECT c.id, aa.title AS a_title, ab.title AS b_title,
                pa.name AS a_pursuit, pb.name AS b_pursuit, c.explanation_text
         FROM connections c
         JOIN artifacts aa ON aa.id = c.artifact_a_id
         JOIN artifacts ab ON ab.id = c.artifact_b_id
         JOIN pursuits pa ON pa.id = aa.pursuit_id
         JOIN pursuits pb ON pb.id = ab.pursuit_id
         WHERE c.id = $1 AND pa.is_public = 1 AND pb.is_public = 1`,
        [r.ref_id],
      );
      if (!c[0]) continue;
      base.connection = c[0];
    } else {
      const { rows: p } = await query<FeedItem['pursuit']>(
        `SELECT id, name, description FROM pursuits WHERE id = $1 AND is_public = 1`,
        [r.ref_id],
      );
      if (!p[0]) continue;
      base.pursuit = p[0];
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

export async function atlasNodes(cap = 150): Promise<{ nodes: AtlasNode[]; total: number }> {
  // Public pursuits merged by normalized name; activity from feed_events with
  // the same live-row filter the feed uses (ranking query, premise-consistent).
  const { rows } = await query<AtlasNode>(
    `WITH pub AS (
       SELECT p.id, p.user_id, p.name, lower(trim(p.name)) AS norm
       FROM pursuits p WHERE p.is_public = 1
     ),
     act AS (
       SELECT lower(trim(p.name)) AS norm,
              COUNT(*)::int AS events30d,
              SUM(CASE WHEN e.created_at >= now() - interval '1 day' THEN 1 ELSE 0 END)::int AS active24h
       FROM feed_events e
       JOIN artifacts a ON e.kind = 'artifact' AND a.id = e.ref_id
       JOIN pursuits p ON p.id = a.pursuit_id AND p.is_public = 1
       WHERE e.created_at >= now() - interval '30 day'
       GROUP BY lower(trim(p.name))
     )
     SELECT pub.norm,
            MIN(pub.name) AS display_name,
            COUNT(DISTINCT pub.user_id)::int AS member_count,
            COALESCE(MAX(act.active24h), 0)::int AS active24h,
            COALESCE(MAX(act.events30d), 0)::int AS events30d
     FROM pub LEFT JOIN act ON act.norm = pub.norm
     GROUP BY pub.norm
     ORDER BY events30d DESC, member_count DESC, pub.norm ASC`,
  );
  return { nodes: rows.slice(0, cap), total: rows.length };
}

// ── People & overlap ───────────────────────────────────

/** Viewer's own pursuits (public AND private) count toward overlap; only the
    other person's public pursuits are visible or counted for display. */
export async function overlapScore(viewerId: string, targetId: string): Promise<number> {
  const { rows } = await query<{ score: number }>(
    `SELECT COUNT(DISTINCT lower(trim(mine.name)))::int AS score
     FROM pursuits mine
     JOIN pursuits theirs
       ON lower(trim(theirs.name)) = lower(trim(mine.name))
      AND theirs.user_id = $1 AND theirs.is_public = 1
     WHERE mine.user_id = $2`,
    [targetId, viewerId],
  );
  return rows[0]?.score ?? 0;
}

export interface PursuitMember {
  id: string;
  name: string;
  image_url: string;
  public_artifacts: number;
  overlap: number;
  is_following: boolean;
}

export async function pursuitDetail(norm: string, viewerId: string) {
  const { rows: members } = await query<Omit<PursuitMember, 'overlap' | 'is_following'>>(
    `SELECT u.id, u.name, u.image_url,
            (SELECT COUNT(*)::int FROM artifacts a2 JOIN pursuits p2 ON p2.id = a2.pursuit_id
              WHERE p2.user_id = u.id AND p2.is_public = 1) AS public_artifacts
     FROM pursuits p JOIN users u ON u.id = p.user_id
     WHERE p.is_public = 1 AND lower(trim(p.name)) = $1
     GROUP BY u.id
     ORDER BY public_artifacts DESC`,
    [norm],
  );
  const withScores: PursuitMember[] = [];
  for (const m of members) {
    const [{ rows: f }, overlap] = await Promise.all([
      query('SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2', [viewerId, m.id]),
      overlapScore(viewerId, m.id),
    ]);
    withScores.push({ ...m, overlap, is_following: f.length > 0 });
  }
  const { rows: artifacts } = await query(
    `SELECT a.id, a.title, a.kind, substr(a.content, 1, 200) AS snippet,
            ${tsCol('a.created_at', 'created_at')}, u.name AS owner_name, u.id AS owner_id
     FROM artifacts a
     JOIN pursuits p ON p.id = a.pursuit_id AND p.is_public = 1
     JOIN users u ON u.id = p.user_id
     WHERE lower(trim(p.name)) = $1
     ORDER BY a.created_at DESC, a.id DESC LIMIT 20`,
    [norm],
  );
  return { members: withScores, artifacts };
}

export async function profileDetail(targetId: string, viewerId: string) {
  const { rows: userRows } = await query<{ id: string; name: string; image_url: string }>(
    'SELECT id, name, image_url FROM users WHERE id = $1',
    [targetId],
  );
  const user = userRows[0];
  if (!user) return null;
  const { rows: pursuits } = await query(
    `SELECT p.id, p.name, p.description, COUNT(a.id)::int AS artifact_count
     FROM pursuits p LEFT JOIN artifacts a ON a.pursuit_id = p.id
     WHERE p.user_id = $1 AND p.is_public = 1
     GROUP BY p.id ORDER BY artifact_count DESC`,
    [targetId],
  );
  const { rows: artifacts } = await query(
    `SELECT a.id, a.title, a.kind, substr(a.content, 1, 200) AS snippet,
            ${tsCol('a.created_at', 'created_at')}, p.name AS pursuit_name
     FROM artifacts a JOIN pursuits p ON p.id = a.pursuit_id
     WHERE p.user_id = $1 AND p.is_public = 1
     ORDER BY a.created_at DESC, a.id DESC LIMIT 20`,
    [targetId],
  );
  const { rows: fc } = await query<{ followers: number; following: number }>(
    `SELECT
       (SELECT COUNT(*)::int FROM follows WHERE followee_id = $1) AS followers,
       (SELECT COUNT(*)::int FROM follows WHERE follower_id = $1) AS following`,
    [targetId],
  );
  const { rows: rel } = await query<{ is_following: boolean; follows_you: boolean }>(
    `SELECT
       EXISTS (SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2) AS is_following,
       EXISTS (SELECT 1 FROM follows WHERE follower_id = $2 AND followee_id = $1) AS follows_you`,
    [viewerId, targetId],
  );
  const overlap = await overlapScore(viewerId, targetId);
  return {
    user,
    pursuits,
    artifacts,
    followers: fc[0]?.followers ?? 0,
    following: fc[0]?.following ?? 0,
    is_following: rel[0]?.is_following ?? false,
    follows_you: rel[0]?.follows_you ?? false,
    overlap,
  };
}

export async function follow(followerId: string, followeeId: string): Promise<void> {
  await query(
    'INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [followerId, followeeId],
  );
}

export async function unfollow(followerId: string, followeeId: string): Promise<void> {
  await query('DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2', [
    followerId,
    followeeId,
  ]);
}

export async function createReport(
  reporterId: string,
  subjectKind: string,
  subjectId: string,
  reason: string,
): Promise<void> {
  await query(
    'INSERT INTO reports (reporter_id, subject_kind, subject_id, reason) VALUES ($1, $2, $3, $4)',
    [reporterId, subjectKind, subjectId, reason.slice(0, 1000)],
  );
}

export { tx };
