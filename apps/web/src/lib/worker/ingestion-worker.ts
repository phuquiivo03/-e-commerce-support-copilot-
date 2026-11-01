/**
 * Worker CLI entry point.
 *
 *   tsx apps/web/src/lib/worker/ingestion-worker.ts          # poll until empty, then exit
 *   tsx apps/web/src/lib/worker/ingestion-worker.ts --loop   # keep polling forever
 *   tsx apps/web/src/lib/worker/ingestion-worker.ts --once   # process at most one job
 *
 * Environment is loaded from apps/web/.env.local when present (SUPABASE_DB_URL
 * overrides the local default connection string).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { getWorkerDbUrl, processNextJob } from './ingestion';

// Minimal .env loader (no dependency): populates process.env for library code.
const here = dirname(fileURLToPath(import.meta.url));
const envPath = join(here, '../../../.env.local');
try {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match && !(match[1]! in process.env)) {
      process.env[match[1]!] = match[2]!.replace(/^["']|["']$/g, '');
    }
  }
} catch {
  // No .env.local — rely on exported environment variables.
}

const mode = process.argv.includes('--loop') ? 'loop' : process.argv.includes('--once') ? 'once' : 'drain';
const sql = postgres(getWorkerDbUrl(), { max: 2, onnotice: () => {} });

async function drain(): Promise<void> {
  let processed = 0;
  for (;;) {
    const didWork = await processNextJob(sql);
    if (!didWork) break;
    processed++;
  }
  console.log(`[worker] queue drained (${processed} job${processed === 1 ? '' : 's'} processed)`);
}

try {
  if (mode === 'once') {
    await processNextJob(sql);
  } else {
    await drain();
  }
} finally {
  await sql.end();
}
