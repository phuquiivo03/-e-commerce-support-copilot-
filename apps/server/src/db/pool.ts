import pg from "pg";
import { env } from "../config/env";
import { logger } from "../lib/logger";

const log = logger.child({ module: "db" });

const isLocal = /(localhost|127\.0\.0\.1)/.test(env.DATABASE_URL);

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  // Managed Postgres (Supabase pooler) requires TLS; local dev does not.
  ssl: isLocal ? undefined : { rejectUnauthorized: false },
});

// An idle-client error would otherwise crash the process (unhandled 'error' event).
pool.on("error", (err) => {
  log.error("idle postgres client error", { error: err });
});

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
