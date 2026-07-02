import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Single SQLite file on disk — the file itself is the backup (plus the
// export/import endpoints for explicit .db round-trips).
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dataDir = join(root, 'data');
mkdirSync(dataDir, { recursive: true });

export const db = new Database(join(dataDir, 'polygon.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Shared between the live database and per-user export snapshots.
// Solo mode uses the reserved user id 'local'; Clerk mode uses Clerk ids.
export const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS pursuits (
    id INTEGER PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'local',
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    is_public INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, name)
  );

  CREATE TABLE IF NOT EXISTS artifacts (
    id INTEGER PRIMARY KEY,
    pursuit_id INTEGER NOT NULL REFERENCES pursuits(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('note', 'code', 'image', 'puzzle')),
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS connections (
    id INTEGER PRIMARY KEY,
    artifact_a_id INTEGER NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    artifact_b_id INTEGER NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    explanation_text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS scanned_pairs (
    artifact_a_id INTEGER NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    artifact_b_id INTEGER NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (artifact_a_id, artifact_b_id),
    CHECK (artifact_a_id < artifact_b_id)
  );

  CREATE INDEX IF NOT EXISTS idx_pursuits_user ON pursuits(user_id);
  CREATE INDEX IF NOT EXISTS idx_artifacts_pursuit ON artifacts(pursuit_id);
  CREATE INDEX IF NOT EXISTS idx_connections_a ON connections(artifact_a_id);
  CREATE INDEX IF NOT EXISTS idx_connections_b ON connections(artifact_b_id);
`;

// Pre-multi-user databases have a pursuits table without user_id/is_public and
// a global UNIQUE(name). SQLite can't alter constraints in place, so rebuild
// the table; legacy_alter_table keeps artifacts' FK text pointing at
// "pursuits" (the new table) instead of following the rename.
function migrate() {
  const cols = (db.prepare(`PRAGMA table_info(pursuits)`).all() as { name: string }[]).map(
    (c) => c.name,
  );
  if (cols.length > 0 && !cols.includes('user_id')) {
    db.pragma('foreign_keys = OFF');
    db.pragma('legacy_alter_table = ON');
    db.exec(`
      BEGIN;
      ALTER TABLE pursuits RENAME TO pursuits_old;
      CREATE TABLE pursuits (
        id INTEGER PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'local',
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        is_public INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (user_id, name)
      );
      INSERT INTO pursuits (id, user_id, name, description, is_public, created_at)
        SELECT id, 'local', name, description, 0, created_at FROM pursuits_old;
      DROP TABLE pursuits_old;
      COMMIT;
    `);
    db.pragma('legacy_alter_table = OFF');
    db.pragma('foreign_keys = ON');
  }
}

migrate();
db.exec(SCHEMA);

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

export function upsertUser(id: string, name: string, imageUrl: string): void {
  db.prepare(
    `INSERT INTO users (id, name, image_url) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, image_url = excluded.image_url`,
  ).run(id, name, imageUrl);
}

export function getUser(id: string): User | undefined {
  return db.prepare('SELECT id, name, image_url FROM users WHERE id = ?').get(id) as
    | User
    | undefined;
}

export function listPursuits(userId: string): Pursuit[] {
  return db
    .prepare(
      `SELECT p.*,
              COUNT(a.id) AS artifact_count,
              MAX(a.created_at) AS last_artifact_at
       FROM pursuits p
       LEFT JOIN artifacts a ON a.pursuit_id = p.id
       WHERE p.user_id = ?
       GROUP BY p.id
       ORDER BY p.created_at ASC`,
    )
    .all(userId) as Pursuit[];
}

export function createPursuit(userId: string, name: string, description: string): Pursuit {
  const info = db
    .prepare('INSERT INTO pursuits (user_id, name, description) VALUES (?, ?, ?)')
    .run(userId, name.trim(), description.trim());
  return db
    .prepare(
      `SELECT p.*, 0 AS artifact_count, NULL AS last_artifact_at FROM pursuits p WHERE p.id = ?`,
    )
    .get(info.lastInsertRowid) as Pursuit;
}

export function updatePursuit(
  userId: string,
  id: number,
  name: string,
  description: string,
  isPublic: boolean,
): void {
  db.prepare(
    'UPDATE pursuits SET name = ?, description = ?, is_public = ? WHERE id = ? AND user_id = ?',
  ).run(name.trim(), description.trim(), isPublic ? 1 : 0, id, userId);
}

export function deletePursuit(userId: string, id: number): void {
  db.prepare('DELETE FROM pursuits WHERE id = ? AND user_id = ?').run(id, userId);
}

export function pursuitOwnedBy(userId: string, id: number): boolean {
  return Boolean(
    db.prepare('SELECT 1 FROM pursuits WHERE id = ? AND user_id = ?').get(id, userId),
  );
}

export function pursuitIsPublic(id: number): boolean {
  const row = db.prepare('SELECT is_public FROM pursuits WHERE id = ?').get(id) as
    | { is_public: number }
    | undefined;
  return Boolean(row?.is_public);
}

export function artifactOwnedBy(userId: string, id: number): boolean {
  return Boolean(
    db
      .prepare(
        'SELECT 1 FROM artifacts a JOIN pursuits p ON p.id = a.pursuit_id WHERE a.id = ? AND p.user_id = ?',
      )
      .get(id, userId),
  );
}

export function listArtifacts(userId: string): Artifact[] {
  return db
    .prepare(
      `SELECT a.*, p.name AS pursuit_name
       FROM artifacts a JOIN pursuits p ON p.id = a.pursuit_id
       WHERE p.user_id = ?
       ORDER BY a.created_at DESC, a.id DESC`,
    )
    .all(userId) as Artifact[];
}

export function createArtifact(
  pursuitId: number,
  kind: Artifact['kind'],
  title: string,
  content: string,
): Artifact {
  const info = db
    .prepare('INSERT INTO artifacts (pursuit_id, kind, title, content) VALUES (?, ?, ?, ?)')
    .run(pursuitId, kind, title.trim(), content);
  return db
    .prepare(
      `SELECT a.*, p.name AS pursuit_name FROM artifacts a JOIN pursuits p ON p.id = a.pursuit_id WHERE a.id = ?`,
    )
    .get(info.lastInsertRowid) as Artifact;
}

export function updateArtifact(
  id: number,
  kind: Artifact['kind'],
  title: string,
  content: string,
): void {
  db.prepare('UPDATE artifacts SET kind = ?, title = ?, content = ? WHERE id = ?').run(
    kind,
    title.trim(),
    content,
    id,
  );
}

export function deleteArtifact(id: number): void {
  // FK cascades remove this artifact's connections and scanned-pair records.
  db.prepare('DELETE FROM artifacts WHERE id = ?').run(id);
}

export interface ConnectionRow extends Connection {
  a_title: string;
  b_title: string;
  a_pursuit: string;
  b_pursuit: string;
}

export function listConnections(userId: string): ConnectionRow[] {
  return db
    .prepare(
      `SELECT c.*,
              aa.title AS a_title, ab.title AS b_title,
              pa.name AS a_pursuit, pb.name AS b_pursuit
       FROM connections c
       JOIN artifacts aa ON aa.id = c.artifact_a_id
       JOIN artifacts ab ON ab.id = c.artifact_b_id
       JOIN pursuits pa ON pa.id = aa.pursuit_id
       JOIN pursuits pb ON pb.id = ab.pursuit_id
       WHERE pa.user_id = ? AND pb.user_id = ?
       ORDER BY c.created_at DESC, c.id DESC`,
    )
    .all(userId, userId) as ConnectionRow[];
}

export function connectionOwnedBy(userId: string, id: number): boolean {
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM connections c
         JOIN artifacts aa ON aa.id = c.artifact_a_id
         JOIN pursuits pa ON pa.id = aa.pursuit_id
         WHERE c.id = ? AND pa.user_id = ?`,
      )
      .get(id, userId),
  );
}

export function deleteConnection(id: number): void {
  db.prepare('DELETE FROM connections WHERE id = ?').run(id);
}

/** Candidate pairs for a scan: every unordered same-user artifact pair not yet scanned. */
export function unscannedPairs(userId: string): [number, number][] {
  const rows = db
    .prepare(
      `SELECT a1.id AS a, a2.id AS b
       FROM artifacts a1
       JOIN pursuits p1 ON p1.id = a1.pursuit_id
       JOIN artifacts a2 ON a1.id < a2.id
       JOIN pursuits p2 ON p2.id = a2.pursuit_id
       WHERE p1.user_id = ? AND p2.user_id = ?
         AND NOT EXISTS (
           SELECT 1 FROM scanned_pairs sp
           WHERE sp.artifact_a_id = a1.id AND sp.artifact_b_id = a2.id
         )
       ORDER BY a2.created_at DESC, a1.created_at DESC`,
    )
    .all(userId, userId) as { a: number; b: number }[];
  return rows.map((r) => [r.a, r.b]);
}

export const recordScanResults = db.transaction(
  (
    pairs: [number, number][],
    found: { artifact_a_id: number; artifact_b_id: number; explanation_text: string }[],
  ): number[] => {
    const markScanned = db.prepare(
      'INSERT OR IGNORE INTO scanned_pairs (artifact_a_id, artifact_b_id) VALUES (?, ?)',
    );
    for (const [a, b] of pairs) {
      markScanned.run(Math.min(a, b), Math.max(a, b));
    }
    const insertConn = db.prepare(
      'INSERT INTO connections (artifact_a_id, artifact_b_id, explanation_text) VALUES (?, ?, ?)',
    );
    const ids: number[] = [];
    for (const c of found) {
      const info = insertConn.run(c.artifact_a_id, c.artifact_b_id, c.explanation_text);
      ids.push(Number(info.lastInsertRowid));
    }
    return ids;
  },
);

// ── Community ──────────────────────────────────────────

export interface CommunityMember extends User {
  public_pursuits: number;
  public_artifacts: number;
  pursuit_names: string;
}

export function communityMembers(): CommunityMember[] {
  return db
    .prepare(
      `SELECT u.id, u.name, u.image_url,
              (SELECT COUNT(*) FROM pursuits p WHERE p.user_id = u.id AND p.is_public = 1) AS public_pursuits,
              (SELECT COUNT(*) FROM artifacts a JOIN pursuits p ON p.id = a.pursuit_id
                WHERE p.user_id = u.id AND p.is_public = 1) AS public_artifacts,
              COALESCE((SELECT GROUP_CONCAT(p.name, ' · ') FROM pursuits p
                WHERE p.user_id = u.id AND p.is_public = 1), '') AS pursuit_names
       FROM users u
       ORDER BY u.created_at ASC`,
    )
    .all() as CommunityMember[];
}

export interface PublicConnection extends ConnectionRow {
  owner_id: string;
  owner_name: string;
  owner_image: string;
}

/** Connections whose BOTH endpoints sit in public pursuits — the Commons feed. */
export function publicConnections(limit = 50): PublicConnection[] {
  return db
    .prepare(
      `SELECT c.*,
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
       LIMIT ?`,
    )
    .all(limit) as PublicConnection[];
}

// ── Export / import ────────────────────────────────────

/** A self-contained .db snapshot of one user's rows (ids preserved). */
export function exportUserDb(userId: string): Buffer {
  const mem = new Database(':memory:');
  mem.exec(SCHEMA);
  const user = getUser(userId);
  mem
    .prepare('INSERT INTO users (id, name, image_url) VALUES (?, ?, ?)')
    .run(userId, user?.name ?? '', user?.image_url ?? '');

  const pursuits = db.prepare('SELECT * FROM pursuits WHERE user_id = ?').all(userId) as Record<
    string,
    unknown
  >[];
  const insP = mem.prepare(
    'INSERT INTO pursuits (id, user_id, name, description, is_public, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  for (const p of pursuits) {
    insP.run(p.id, p.user_id, p.name, p.description, p.is_public, p.created_at);
  }

  const artifacts = db
    .prepare(
      'SELECT a.* FROM artifacts a JOIN pursuits p ON p.id = a.pursuit_id WHERE p.user_id = ?',
    )
    .all(userId) as Record<string, unknown>[];
  const insA = mem.prepare(
    'INSERT INTO artifacts (id, pursuit_id, kind, title, content, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  for (const a of artifacts) {
    insA.run(a.id, a.pursuit_id, a.kind, a.title, a.content, a.created_at);
  }

  const conns = db
    .prepare(
      `SELECT c.* FROM connections c
       JOIN artifacts aa ON aa.id = c.artifact_a_id
       JOIN pursuits pa ON pa.id = aa.pursuit_id
       WHERE pa.user_id = ?`,
    )
    .all(userId) as Record<string, unknown>[];
  const insC = mem.prepare(
    'INSERT INTO connections (id, artifact_a_id, artifact_b_id, explanation_text, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  for (const c of conns) {
    insC.run(c.id, c.artifact_a_id, c.artifact_b_id, c.explanation_text, c.created_at);
  }

  const pairs = db
    .prepare(
      `SELECT sp.* FROM scanned_pairs sp
       JOIN artifacts aa ON aa.id = sp.artifact_a_id
       JOIN pursuits pa ON pa.id = aa.pursuit_id
       WHERE pa.user_id = ?`,
    )
    .all(userId) as Record<string, unknown>[];
  const insSp = mem.prepare(
    'INSERT INTO scanned_pairs (artifact_a_id, artifact_b_id, scanned_at) VALUES (?, ?, ?)',
  );
  for (const sp of pairs) {
    insSp.run(sp.artifact_a_id, sp.artifact_b_id, sp.scanned_at);
  }

  const buf = mem.serialize();
  mem.close();
  return buf;
}

/**
 * Replace the user's data with the contents of an exported .db file.
 * Incoming ids are remapped so they can't collide with other users' rows.
 * Runs in one transaction: a bad file leaves the database untouched.
 */
export function importUserDb(userId: string, source: Database.Database): {
  pursuits: number;
  artifacts: number;
  connections: number;
} {
  const srcPursuits = source.prepare('SELECT * FROM pursuits').all() as Record<string, unknown>[];
  const srcArtifacts = source.prepare('SELECT * FROM artifacts').all() as Record<
    string,
    unknown
  >[];
  const srcConns = source.prepare('SELECT * FROM connections').all() as Record<string, unknown>[];
  const srcPairs = source.prepare('SELECT * FROM scanned_pairs').all() as Record<
    string,
    unknown
  >[];

  const run = db.transaction(() => {
    db.prepare('DELETE FROM pursuits WHERE user_id = ?').run(userId); // cascades

    const pMap = new Map<number, number>();
    const insP = db.prepare(
      'INSERT INTO pursuits (user_id, name, description, is_public, created_at) VALUES (?, ?, ?, ?, ?)',
    );
    for (const p of srcPursuits) {
      const info = insP.run(userId, p.name, p.description ?? '', p.is_public ?? 0, p.created_at);
      pMap.set(p.id as number, Number(info.lastInsertRowid));
    }

    const aMap = new Map<number, number>();
    const insA = db.prepare(
      'INSERT INTO artifacts (pursuit_id, kind, title, content, created_at) VALUES (?, ?, ?, ?, ?)',
    );
    for (const a of srcArtifacts) {
      const pid = pMap.get(a.pursuit_id as number);
      if (pid === undefined) continue; // orphan row in a hand-edited file
      const info = insA.run(pid, a.kind, a.title, a.content ?? '', a.created_at);
      aMap.set(a.id as number, Number(info.lastInsertRowid));
    }

    let connCount = 0;
    const insC = db.prepare(
      'INSERT INTO connections (artifact_a_id, artifact_b_id, explanation_text, created_at) VALUES (?, ?, ?, ?)',
    );
    for (const c of srcConns) {
      const a = aMap.get(c.artifact_a_id as number);
      const b = aMap.get(c.artifact_b_id as number);
      if (a === undefined || b === undefined) continue;
      insC.run(a, b, c.explanation_text, c.created_at);
      connCount++;
    }

    const insSp = db.prepare(
      'INSERT OR IGNORE INTO scanned_pairs (artifact_a_id, artifact_b_id, scanned_at) VALUES (?, ?, ?)',
    );
    for (const sp of srcPairs) {
      const a = aMap.get(sp.artifact_a_id as number);
      const b = aMap.get(sp.artifact_b_id as number);
      if (a === undefined || b === undefined) continue;
      insSp.run(Math.min(a, b), Math.max(a, b), sp.scanned_at);
    }

    return { pursuits: pMap.size, artifacts: aMap.size, connections: connCount };
  });

  return run();
}
