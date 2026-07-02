import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Single SQLite file on disk — the file itself is the backup (design doc: no
// export/import tooling in V1, deliberately not browser storage).
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dataDir = join(root, 'data');
mkdirSync(dataDir, { recursive: true });

export const db = new Database(join(dataDir, 'polygon.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS pursuits (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
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

  -- Every pair the scanner has already evaluated (connection found or not).
  -- Enforces the design rule: each artifact pair is scanned at most once.
  CREATE TABLE IF NOT EXISTS scanned_pairs (
    artifact_a_id INTEGER NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    artifact_b_id INTEGER NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (artifact_a_id, artifact_b_id),
    CHECK (artifact_a_id < artifact_b_id)
  );

  CREATE INDEX IF NOT EXISTS idx_artifacts_pursuit ON artifacts(pursuit_id);
  CREATE INDEX IF NOT EXISTS idx_connections_a ON connections(artifact_a_id);
  CREATE INDEX IF NOT EXISTS idx_connections_b ON connections(artifact_b_id);
`);

export interface Pursuit {
  id: number;
  name: string;
  description: string;
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

export function listPursuits(): Pursuit[] {
  return db
    .prepare(
      `SELECT p.*,
              COUNT(a.id) AS artifact_count,
              MAX(a.created_at) AS last_artifact_at
       FROM pursuits p
       LEFT JOIN artifacts a ON a.pursuit_id = p.id
       GROUP BY p.id
       ORDER BY p.created_at ASC`,
    )
    .all() as Pursuit[];
}

export function createPursuit(name: string, description: string): Pursuit {
  const info = db
    .prepare('INSERT INTO pursuits (name, description) VALUES (?, ?)')
    .run(name.trim(), description.trim());
  return db
    .prepare(
      `SELECT p.*, 0 AS artifact_count, NULL AS last_artifact_at FROM pursuits p WHERE p.id = ?`,
    )
    .get(info.lastInsertRowid) as Pursuit;
}

export function updatePursuit(id: number, name: string, description: string): void {
  db.prepare('UPDATE pursuits SET name = ?, description = ? WHERE id = ?').run(
    name.trim(),
    description.trim(),
    id,
  );
}

export function deletePursuit(id: number): void {
  db.prepare('DELETE FROM pursuits WHERE id = ?').run(id);
}

export function listArtifacts(): Artifact[] {
  return db
    .prepare(
      `SELECT a.*, p.name AS pursuit_name
       FROM artifacts a JOIN pursuits p ON p.id = a.pursuit_id
       ORDER BY a.created_at DESC, a.id DESC`,
    )
    .all() as Artifact[];
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

export function listConnections(): (Connection & {
  a_title: string;
  b_title: string;
  a_pursuit: string;
  b_pursuit: string;
})[] {
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
       ORDER BY c.created_at DESC, c.id DESC`,
    )
    .all() as ReturnType<typeof listConnections>;
}

/** Candidate pairs for a scan: every unordered artifact pair not yet in scanned_pairs. */
export function unscannedPairs(): [number, number][] {
  const rows = db
    .prepare(
      `SELECT a1.id AS a, a2.id AS b
       FROM artifacts a1
       JOIN artifacts a2 ON a1.id < a2.id
       WHERE NOT EXISTS (
         SELECT 1 FROM scanned_pairs sp
         WHERE sp.artifact_a_id = a1.id AND sp.artifact_b_id = a2.id
       )
       ORDER BY a2.created_at DESC, a1.created_at DESC`,
    )
    .all() as { a: number; b: number }[];
  return rows.map((r) => [r.a, r.b]);
}

export const recordScanResults = db.transaction(
  (pairs: [number, number][], found: { artifact_a_id: number; artifact_b_id: number; explanation_text: string }[]) => {
    const markScanned = db.prepare(
      'INSERT OR IGNORE INTO scanned_pairs (artifact_a_id, artifact_b_id) VALUES (?, ?)',
    );
    for (const [a, b] of pairs) {
      markScanned.run(Math.min(a, b), Math.max(a, b));
    }
    const insertConn = db.prepare(
      'INSERT INTO connections (artifact_a_id, artifact_b_id, explanation_text) VALUES (?, ?, ?)',
    );
    for (const c of found) {
      insertConn.run(c.artifact_a_id, c.artifact_b_id, c.explanation_text);
    }
  },
);
