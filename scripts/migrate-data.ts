// One-time copy of the old local SQLite database into Postgres (Supabase).
// Reads data/polygon.db, remaps auto-generated ids, preserves user_ids and
// timestamps. Safe to re-run only after truncating — it appends. Run:
//   npm run migrate:data
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { tx } from '../server/pg';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sqlitePath = join(root, 'data', 'polygon.db');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Add it to .env, then re-run: npm run migrate:data');
    process.exit(2);
  }
  if (!existsSync(sqlitePath)) {
    console.log(`No SQLite database at ${sqlitePath} — nothing to migrate. (Fresh start is fine.)`);
    process.exit(0);
  }
  const src = new Database(sqlitePath, { readonly: true });
  const tables = new Set(
    (src.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[]).map(
      (t) => t.name,
    ),
  );
  const rows = (t: string) => (tables.has(t) ? (src.prepare(`SELECT * FROM ${t}`).all() as Record<string, unknown>[]) : []);

  const counts = await tx(async (q) => {
    // users (ids are text, preserved)
    for (const u of rows('users')) {
      await q(
        `INSERT INTO users (id, name, image_url, openai_api_key, created_at) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (id) DO NOTHING`,
        [u.id, u.name ?? '', u.image_url ?? '', u.openai_api_key ?? '', u.created_at],
      );
    }
    // Ensure every pursuit owner exists as a user (older rows predate the users table).
    const ownerIds = new Set(rows('pursuits').map((p) => String(p.user_id ?? 'local')));
    for (const id of ownerIds) {
      await q(`INSERT INTO users (id, name) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING`, [
        id,
        id === 'local' ? 'You' : 'Polymath',
      ]);
    }

    const pMap = new Map<number, number>();
    for (const p of rows('pursuits')) {
      const r = await q(
        `INSERT INTO pursuits (user_id, name, description, is_public, created_at)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [p.user_id ?? 'local', p.name, p.description ?? '', p.is_public ?? 0, p.created_at],
      );
      pMap.set(Number(p.id), (r.rows[0] as { id: number }).id);
    }

    const aMap = new Map<number, number>();
    for (const a of rows('artifacts')) {
      const pid = pMap.get(Number(a.pursuit_id));
      if (pid === undefined) continue;
      const r = await q(
        `INSERT INTO artifacts (pursuit_id, kind, title, content, created_at)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [pid, a.kind, a.title, a.content ?? '', a.created_at],
      );
      aMap.set(Number(a.id), (r.rows[0] as { id: number }).id);
    }

    const cMap = new Map<number, number>();
    for (const c of rows('connections')) {
      const a = aMap.get(Number(c.artifact_a_id));
      const b = aMap.get(Number(c.artifact_b_id));
      if (a === undefined || b === undefined) continue;
      const r = await q(
        `INSERT INTO connections (artifact_a_id, artifact_b_id, explanation_text, created_at)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [a, b, c.explanation_text, c.created_at],
      );
      cMap.set(Number(c.id), (r.rows[0] as { id: number }).id);
    }

    for (const sp of rows('scanned_pairs')) {
      const a = aMap.get(Number(sp.artifact_a_id));
      const b = aMap.get(Number(sp.artifact_b_id));
      if (a === undefined || b === undefined) continue;
      await q(
        `INSERT INTO scanned_pairs (artifact_a_id, artifact_b_id, scanned_at)
         VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [Math.min(a, b), Math.max(a, b), sp.scanned_at],
      );
    }

    for (const f of rows('follows')) {
      await q(
        `INSERT INTO follows (follower_id, followee_id, created_at) VALUES ($1,$2,$3)
         ON CONFLICT DO NOTHING`,
        [f.follower_id, f.followee_id, f.created_at],
      );
    }

    // feed_events ref_id points at a pursuit/artifact/connection — remap by kind.
    let feedCopied = 0;
    for (const e of rows('feed_events')) {
      const map = e.kind === 'artifact' ? aMap : e.kind === 'connection' ? cMap : pMap;
      const ref = map.get(Number(e.ref_id));
      if (ref === undefined) continue;
      await q(`INSERT INTO feed_events (user_id, kind, ref_id, created_at) VALUES ($1,$2,$3,$4)`, [
        e.user_id,
        e.kind,
        ref,
        e.created_at,
      ]);
      feedCopied++;
    }

    return {
      users: rows('users').length,
      pursuits: pMap.size,
      artifacts: aMap.size,
      connections: cMap.size,
      feed_events: feedCopied,
    };
  });

  src.close();
  console.log('Migrated from SQLite → Supabase:', counts);
  process.exit(0);
}

main().catch((e) => {
  console.error('Data migration failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
