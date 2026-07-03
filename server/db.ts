import { query, tx, tsCol, type Querier } from './pg';

// Postgres schema. Integer identity ids (int4) so pg returns them as JS
// numbers, not bigint strings. is_public stays smallint 0/1 to keep the
// frontend's `is_public: number` type unchanged. All COUNT/SUM aggregates
// are cast ::int for the same reason.
export const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL DEFAULT '',
    openai_api_key TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS pursuits (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'local',
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    is_public SMALLINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, name)
  );

  CREATE TABLE IF NOT EXISTS artifacts (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pursuit_id INTEGER NOT NULL REFERENCES pursuits(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('note', 'code', 'image', 'puzzle')),
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS connections (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    artifact_a_id INTEGER NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    artifact_b_id INTEGER NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    explanation_text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS scanned_pairs (
    artifact_a_id INTEGER NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    artifact_b_id INTEGER NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    scanned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (artifact_a_id, artifact_b_id),
    CHECK (artifact_a_id < artifact_b_id)
  );

  CREATE TABLE IF NOT EXISTS follows (
    follower_id TEXT NOT NULL,
    followee_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (follower_id, followee_id)
  );

  CREATE TABLE IF NOT EXISTS feed_events (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('artifact', 'connection', 'pursuit_public')),
    ref_id INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    reporter_id TEXT NOT NULL,
    subject_kind TEXT NOT NULL CHECK (subject_kind IN ('user', 'artifact', 'pursuit', 'connection')),
    subject_id TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_pursuits_user ON pursuits(user_id);
  CREATE INDEX IF NOT EXISTS idx_artifacts_pursuit ON artifacts(pursuit_id);
  CREATE INDEX IF NOT EXISTS idx_connections_a ON connections(artifact_a_id);
  CREATE INDEX IF NOT EXISTS idx_connections_b ON connections(artifact_b_id);
  CREATE INDEX IF NOT EXISTS idx_feed_events_time ON feed_events(id DESC);
  CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows(followee_id);
`;

export interface User {
  id: string;
  name: string;
  image_url: string;
}

export interface Pursuit {
  id: number;
  user_id: string;
  name: string;
  description: string;
  is_public: number;
  created_at: string;
  artifact_count: number;
  last_artifact_at: string | null;
}

export interface Artifact {
  id: number;
  pursuit_id: number;
  kind: 'note' | 'code' | 'image' | 'puzzle';
  title: string;
  content: string;
  created_at: string;
  pursuit_name?: string;
}

export interface Connection {
  id: number;
  artifact_a_id: number;
  artifact_b_id: number;
  explanation_text: string;
  created_at: string;
}

export async function upsertUser(id: string, name: string, imageUrl: string): Promise<void> {
  await query(
    `INSERT INTO users (id, name, image_url) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, image_url = EXCLUDED.image_url`,
    [id, name, imageUrl],
  );
}

export async function getUser(id: string): Promise<User | undefined> {
  const { rows } = await query<User>('SELECT id, name, image_url FROM users WHERE id = $1', [id]);
  return rows[0];
}

// Per-user OpenAI key: users who don't run their own server can bring a key
// via the settings panel, stored server-side and never returned to the client.
export async function userHasOpenAiApiKey(id: string): Promise<boolean> {
  const { rows } = await query<{ openai_api_key: string }>(
    'SELECT openai_api_key FROM users WHERE id = $1',
    [id],
  );
  return Boolean(rows[0]?.openai_api_key);
}

export async function getUserOpenAiApiKey(id: string): Promise<string | null> {
  const { rows } = await query<{ openai_api_key: string }>(
    'SELECT openai_api_key FROM users WHERE id = $1',
    [id],
  );
  return rows[0]?.openai_api_key || null;
}

export async function updateUserOpenAiApiKey(id: string, apiKey: string): Promise<void> {
  await query('UPDATE users SET openai_api_key = $1 WHERE id = $2', [apiKey.trim(), id]);
}

export async function listPursuits(userId: string): Promise<Pursuit[]> {
  const { rows } = await query<Pursuit>(
    `SELECT p.id, p.user_id, p.name, p.description, p.is_public,
            ${tsCol('p.created_at', 'created_at')},
            COUNT(a.id)::int AS artifact_count,
            ${tsCol('MAX(a.created_at)', 'last_artifact_at')}
     FROM pursuits p
     LEFT JOIN artifacts a ON a.pursuit_id = p.id
     WHERE p.user_id = $1
     GROUP BY p.id
     ORDER BY p.created_at ASC`,
    [userId],
  );
  return rows;
}

export async function createPursuit(
  userId: string,
  name: string,
  description: string,
): Promise<Pursuit> {
  const { rows } = await query<Pursuit>(
    `INSERT INTO pursuits (user_id, name, description) VALUES ($1, $2, $3)
     RETURNING id, user_id, name, description, is_public,
               ${tsCol('created_at', 'created_at')},
               0 AS artifact_count, NULL AS last_artifact_at`,
    [userId, name.trim(), description.trim()],
  );
  return rows[0];
}

export async function updatePursuit(
  userId: string,
  id: number,
  name: string,
  description: string,
  isPublic: boolean,
): Promise<void> {
  await query(
    'UPDATE pursuits SET name = $1, description = $2, is_public = $3 WHERE id = $4 AND user_id = $5',
    [name.trim(), description.trim(), isPublic ? 1 : 0, id, userId],
  );
}

export async function deletePursuit(userId: string, id: number): Promise<void> {
  await query('DELETE FROM pursuits WHERE id = $1 AND user_id = $2', [id, userId]);
}

export async function pursuitOwnedBy(userId: string, id: number): Promise<boolean> {
  const { rowCount } = await query('SELECT 1 FROM pursuits WHERE id = $1 AND user_id = $2', [id, userId]);
  return rowCount > 0;
}

export async function pursuitIsPublic(id: number): Promise<boolean> {
  const { rows } = await query<{ is_public: number }>(
    'SELECT is_public FROM pursuits WHERE id = $1',
    [id],
  );
  return Boolean(rows[0]?.is_public);
}

export async function artifactOwnedBy(userId: string, id: number): Promise<boolean> {
  const { rowCount } = await query(
    'SELECT 1 FROM artifacts a JOIN pursuits p ON p.id = a.pursuit_id WHERE a.id = $1 AND p.user_id = $2',
    [id, userId],
  );
  return rowCount > 0;
}

export async function listArtifacts(userId: string): Promise<Artifact[]> {
  const { rows } = await query<Artifact>(
    `SELECT a.id, a.pursuit_id, a.kind, a.title, a.content,
            ${tsCol('a.created_at', 'created_at')}, p.name AS pursuit_name
     FROM artifacts a JOIN pursuits p ON p.id = a.pursuit_id
     WHERE p.user_id = $1
     ORDER BY a.created_at DESC, a.id DESC`,
    [userId],
  );
  return rows;
}

export async function createArtifact(
  pursuitId: number,
  kind: Artifact['kind'],
  title: string,
  content: string,
): Promise<Artifact> {
  const { rows } = await query<Artifact>(
    `WITH ins AS (
       INSERT INTO artifacts (pursuit_id, kind, title, content) VALUES ($1, $2, $3, $4)
       RETURNING id, pursuit_id, kind, title, content, created_at
     )
     SELECT ins.id, ins.pursuit_id, ins.kind, ins.title, ins.content,
            ${tsCol('ins.created_at', 'created_at')}, p.name AS pursuit_name
     FROM ins JOIN pursuits p ON p.id = ins.pursuit_id`,
    [pursuitId, kind, title.trim(), content],
  );
  return rows[0];
}

export async function updateArtifact(
  id: number,
  kind: Artifact['kind'],
  title: string,
  content: string,
): Promise<void> {
  await query('UPDATE artifacts SET kind = $1, title = $2, content = $3 WHERE id = $4', [
    kind,
    title.trim(),
    content,
    id,
  ]);
}

export async function deleteArtifact(id: number): Promise<void> {
  // FK cascades remove this artifact's connections and scanned-pair records.
  await query('DELETE FROM artifacts WHERE id = $1', [id]);
}

export interface ConnectionRow extends Connection {
  a_title: string;
  b_title: string;
  a_pursuit: string;
  b_pursuit: string;
}

export async function listConnections(userId: string): Promise<ConnectionRow[]> {
  const { rows } = await query<ConnectionRow>(
    `SELECT c.id, c.artifact_a_id, c.artifact_b_id, c.explanation_text,
            ${tsCol('c.created_at', 'created_at')},
            aa.title AS a_title, ab.title AS b_title,
            pa.name AS a_pursuit, pb.name AS b_pursuit
     FROM connections c
     JOIN artifacts aa ON aa.id = c.artifact_a_id
     JOIN artifacts ab ON ab.id = c.artifact_b_id
     JOIN pursuits pa ON pa.id = aa.pursuit_id
     JOIN pursuits pb ON pb.id = ab.pursuit_id
     WHERE pa.user_id = $1 AND pb.user_id = $1
     ORDER BY c.created_at DESC, c.id DESC`,
    [userId],
  );
  return rows;
}

export async function connectionOwnedBy(userId: string, id: number): Promise<boolean> {
  const { rowCount } = await query(
    `SELECT 1 FROM connections c
     JOIN artifacts aa ON aa.id = c.artifact_a_id
     JOIN pursuits pa ON pa.id = aa.pursuit_id
     WHERE c.id = $1 AND pa.user_id = $2`,
    [id, userId],
  );
  return rowCount > 0;
}

export async function deleteConnection(id: number): Promise<void> {
  await query('DELETE FROM connections WHERE id = $1', [id]);
}

/** Candidate pairs for a scan: every unordered same-user artifact pair not yet scanned. */
export async function unscannedPairs(userId: string): Promise<[number, number][]> {
  const { rows } = await query<{ a: number; b: number }>(
    `SELECT a1.id AS a, a2.id AS b
     FROM artifacts a1
     JOIN pursuits p1 ON p1.id = a1.pursuit_id
     JOIN artifacts a2 ON a1.id < a2.id
     JOIN pursuits p2 ON p2.id = a2.pursuit_id
     WHERE p1.user_id = $1 AND p2.user_id = $1
       AND NOT EXISTS (
         SELECT 1 FROM scanned_pairs sp
         WHERE sp.artifact_a_id = a1.id AND sp.artifact_b_id = a2.id
       )
     ORDER BY a2.created_at DESC, a1.created_at DESC`,
    [userId],
  );
  return rows.map((r) => [r.a, r.b]);
}

export async function recordScanResults(
  pairs: [number, number][],
  found: { artifact_a_id: number; artifact_b_id: number; explanation_text: string }[],
): Promise<number[]> {
  return tx(async (q) => {
    for (const [a, b] of pairs) {
      await q(
        'INSERT INTO scanned_pairs (artifact_a_id, artifact_b_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [Math.min(a, b), Math.max(a, b)],
      );
    }
    const ids: number[] = [];
    for (const c of found) {
      const r = await q(
        'INSERT INTO connections (artifact_a_id, artifact_b_id, explanation_text) VALUES ($1, $2, $3) RETURNING id',
        [c.artifact_a_id, c.artifact_b_id, c.explanation_text],
      );
      ids.push((r.rows[0] as { id: number }).id);
    }
    return ids;
  });
}

// ── Community ──────────────────────────────────────────

export interface CommunityMember extends User {
  public_pursuits: number;
  public_artifacts: number;
  pursuit_names: string;
}

export async function communityMembers(): Promise<CommunityMember[]> {
  const { rows } = await query<CommunityMember>(
    `SELECT u.id, u.name, u.image_url,
            (SELECT COUNT(*)::int FROM pursuits p WHERE p.user_id = u.id AND p.is_public = 1) AS public_pursuits,
            (SELECT COUNT(*)::int FROM artifacts a JOIN pursuits p ON p.id = a.pursuit_id
              WHERE p.user_id = u.id AND p.is_public = 1) AS public_artifacts,
            COALESCE((SELECT string_agg(p.name, ' · ') FROM pursuits p
              WHERE p.user_id = u.id AND p.is_public = 1), '') AS pursuit_names
     FROM users u
     ORDER BY u.created_at ASC`,
  );
  return rows;
}

export interface PublicConnection extends ConnectionRow {
  owner_id: string;
  owner_name: string;
  owner_image: string;
}

/** Connections whose BOTH endpoints sit in public pursuits — the Commons feed. */
export async function publicConnections(limit = 50): Promise<PublicConnection[]> {
  const { rows } = await query<PublicConnection>(
    `SELECT c.id, c.artifact_a_id, c.artifact_b_id, c.explanation_text,
            ${tsCol('c.created_at', 'created_at')},
            aa.title AS a_title, ab.title AS b_title,
            pa.name AS a_pursuit, pb.name AS b_pursuit,
            u.id AS owner_id, u.name AS owner_name, u.image_url AS owner_image
     FROM connections c
     JOIN artifacts aa ON aa.id = c.artifact_a_id
     JOIN artifacts ab ON ab.id = c.artifact_b_id
     JOIN pursuits pa ON pa.id = aa.pursuit_id
     JOIN pursuits pb ON pb.id = ab.pursuit_id
     JOIN users u ON u.id = pa.user_id
     WHERE pa.is_public = 1 AND pb.is_public = 1
     ORDER BY c.created_at DESC, c.id DESC
     LIMIT $1`,
    [limit],
  );
  return rows;
}

// ── Export / import (JSON) ─────────────────────────────

export interface UserExport {
  format: 'polygon-export';
  version: 1;
  user: { id: string; name: string; image_url: string };
  pursuits: { id: number; name: string; description: string; is_public: number; created_at: string }[];
  artifacts: { id: number; pursuit_id: number; kind: string; title: string; content: string; created_at: string }[];
  connections: { id: number; artifact_a_id: number; artifact_b_id: number; explanation_text: string; created_at: string }[];
  scanned_pairs: { artifact_a_id: number; artifact_b_id: number }[];
}

/** A portable JSON snapshot of one user's rows (ids preserved for internal refs). */
export async function exportUserJson(userId: string): Promise<UserExport> {
  const user = await getUser(userId);
  const pursuits = (
    await query(
      `SELECT id, name, description, is_public, ${tsCol('created_at', 'created_at')}
       FROM pursuits WHERE user_id = $1`,
      [userId],
    )
  ).rows as UserExport['pursuits'];
  const artifacts = (
    await query(
      `SELECT a.id, a.pursuit_id, a.kind, a.title, a.content, ${tsCol('a.created_at', 'created_at')}
       FROM artifacts a JOIN pursuits p ON p.id = a.pursuit_id WHERE p.user_id = $1`,
      [userId],
    )
  ).rows as UserExport['artifacts'];
  const connections = (
    await query(
      `SELECT c.id, c.artifact_a_id, c.artifact_b_id, c.explanation_text, ${tsCol('c.created_at', 'created_at')}
       FROM connections c
       JOIN artifacts aa ON aa.id = c.artifact_a_id
       JOIN pursuits pa ON pa.id = aa.pursuit_id
       WHERE pa.user_id = $1`,
      [userId],
    )
  ).rows as UserExport['connections'];
  const scanned_pairs = (
    await query(
      `SELECT sp.artifact_a_id, sp.artifact_b_id
       FROM scanned_pairs sp
       JOIN artifacts aa ON aa.id = sp.artifact_a_id
       JOIN pursuits pa ON pa.id = aa.pursuit_id
       WHERE pa.user_id = $1`,
      [userId],
    )
  ).rows as UserExport['scanned_pairs'];

  return {
    format: 'polygon-export',
    version: 1,
    user: { id: userId, name: user?.name ?? '', image_url: user?.image_url ?? '' },
    pursuits,
    artifacts,
    connections,
    scanned_pairs,
  };
}

/**
 * Replace the user's data with the contents of an exported JSON snapshot.
 * Incoming ids are remapped so they can't collide with other users' rows.
 * Runs in one transaction: a bad file leaves the database untouched.
 */
export async function importUserJson(
  userId: string,
  data: UserExport,
): Promise<{ pursuits: number; artifacts: number; connections: number }> {
  const pursuits = Array.isArray(data.pursuits) ? data.pursuits : [];
  const artifacts = Array.isArray(data.artifacts) ? data.artifacts : [];
  const connections = Array.isArray(data.connections) ? data.connections : [];
  const scannedPairs = Array.isArray(data.scanned_pairs) ? data.scanned_pairs : [];

  return tx(async (q) => {
    await q('DELETE FROM pursuits WHERE user_id = $1', [userId]); // cascades

    const pMap = new Map<number, number>();
    for (const p of pursuits) {
      const r = await q(
        'INSERT INTO pursuits (user_id, name, description, is_public) VALUES ($1, $2, $3, $4) RETURNING id',
        [userId, p.name, p.description ?? '', p.is_public ?? 0],
      );
      pMap.set(p.id, (r.rows[0] as { id: number }).id);
    }

    const aMap = new Map<number, number>();
    for (const a of artifacts) {
      const pid = pMap.get(a.pursuit_id);
      if (pid === undefined) continue;
      const r = await q(
        'INSERT INTO artifacts (pursuit_id, kind, title, content) VALUES ($1, $2, $3, $4) RETURNING id',
        [pid, a.kind, a.title, a.content ?? ''],
      );
      aMap.set(a.id, (r.rows[0] as { id: number }).id);
    }

    let connCount = 0;
    for (const c of connections) {
      const a = aMap.get(c.artifact_a_id);
      const b = aMap.get(c.artifact_b_id);
      if (a === undefined || b === undefined) continue;
      await q(
        'INSERT INTO connections (artifact_a_id, artifact_b_id, explanation_text) VALUES ($1, $2, $3)',
        [a, b, c.explanation_text],
      );
      connCount++;
    }

    for (const sp of scannedPairs) {
      const a = aMap.get(sp.artifact_a_id);
      const b = aMap.get(sp.artifact_b_id);
      if (a === undefined || b === undefined) continue;
      await q(
        'INSERT INTO scanned_pairs (artifact_a_id, artifact_b_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [Math.min(a, b), Math.max(a, b)],
      );
    }

    return { pursuits: pMap.size, artifacts: aMap.size, connections: connCount };
  });
}

export { query, tsCol, tx, type Querier };
