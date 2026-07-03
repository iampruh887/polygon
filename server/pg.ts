import 'dotenv/config';
import pg from 'pg';

// Single pooled client, reused across serverless invocations within a Vercel
// instance (module state persists under Fluid Compute). Point DATABASE_URL at
// Supabase's TRANSACTION pooler (port 6543) for serverless-safe pooling.
const url = process.env.DATABASE_URL;

const isLocal = !url || /localhost|127\.0\.0\.1/.test(url);

export const pool = new pg.Pool({
  connectionString: url,
  max: Number(process.env.PG_POOL_MAX ?? 3),
  ssl: isLocal ? undefined : { rejectUnauthorized: false },
});

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Add the Supabase transaction-pooler string (port 6543) to .env.',
    );
  }
  const res = await pool.query(text, params);
  return { rows: res.rows as T[], rowCount: res.rowCount ?? 0 };
}

export type Querier = (text: string, params?: unknown[]) => Promise<QueryResult<unknown>>;

/** Run fn inside a single BEGIN/COMMIT transaction on a dedicated client. */
export async function tx<T>(fn: (q: Querier) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const q: Querier = async (text, params = []) => {
      const r = await client.query(text, params);
      return { rows: r.rows, rowCount: r.rowCount ?? 0 };
    };
    const out = await fn(q);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// created_at columns are stored timestamptz; the frontend parses them as
// `new Date(value + 'Z')`, so emit the exact zoneless-UTC string SQLite used.
export function tsCol(expr: string, alias: string): string {
  return `to_char(${expr} AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS ${alias}`;
}

export const DATABASE_CONFIGURED = Boolean(url);
