import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { getEnv } from '@/lib/env';
import type { Database } from '@/lib/database.types';

/**
 * User-scoped client for Route Handlers and Server Components. Reads the
 * session from cookies; all queries run under the caller's identity so RLS is
 * the row-level authorization boundary.
 */
export async function createSupabaseServerClient() {
  const env = getEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component render pass where cookies are
          // read-only; the proxy route refreshes the session instead.
        }
      },
    },
  });
}

/**
 * Service-role client. Server-only: bypasses RLS and must never reach the
 * browser. Used for copilot orchestration, audit writes, ingestion, and other
 * trusted server-side operations that have already authenticated the caller
 * at the route level.
 */
export function createSupabaseServiceClient() {
  const env = getEnv();
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
