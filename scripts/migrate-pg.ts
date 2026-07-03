// Create the Postgres schema in the database pointed to by DATABASE_URL.
// Idempotent (CREATE TABLE IF NOT EXISTS). Run: npm run migrate:pg
import { query } from '../server/pg.js';
import { SCHEMA } from '../server/db.js';

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error(
      'DATABASE_URL is not set.\nAdd the Supabase transaction-pooler string (Settings → Database → Connection string → Transaction, port 6543) to .env, then re-run: npm run migrate:pg',
    );
    process.exit(2);
  }
  await query(SCHEMA);
  console.log('Schema applied. Polygon tables are ready in Supabase.');
  process.exit(0);
}

main().catch((e) => {
  console.error('Migration failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
