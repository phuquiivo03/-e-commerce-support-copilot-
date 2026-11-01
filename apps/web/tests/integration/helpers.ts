/**
 * Shared setup for integration tests: loads apps/web/.env.local and creates
 * clients (service role + user-scoped) against the local Supabase stack.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const here = dirname(fileURLToPath(import.meta.url));
try {
  for (const line of readFileSync(join(here, '../../../.env.local'), 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match && !(match[1]! in process.env)) {
      process.env[match[1]!] = match[2]!.replace(/^["']|["']$/g, '');
    }
  }
} catch {
  // Fall back to exported env.
}

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
export const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
export const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const serviceClient = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

/** Signs in a demo user and returns a client whose requests carry that JWT (RLS applies). */
export async function asUser(email: string): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: 'demo1234' });
  if (error) throw new Error(`Integration test login failed for ${email}: ${error.message}`);
  return client;
}

export const MARIA = 'maria@example.com';
export const DEVON = 'devon@example.com';
export const AGENT = 'agent@demo.local';
export const ADMIN = 'admin@demo.local';
