import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Request } from "express";
import { env } from "../config/env";

const authClientOptions = {
  auth: { persistSession: false, autoRefreshToken: false },
} as const;

/** Anonymous client — verifies access tokens against Supabase Auth and signs users in. */
export function createAnonClient(): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, authClientOptions);
}

/**
 * Runs PostgREST queries under the caller's identity (Authorization header)
 * so RLS is the authorization boundary, mirroring apps/web's user-scoped
 * server client.
 */
export function createUserClient(accessToken: string): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    ...authClientOptions,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/**
 * Service-role client — bypasses RLS. Server-only: used for trusted
 * operations (session revocation) after the caller has been authenticated.
 */
export function createServiceClient(): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, authClientOptions);
}

/**
 * Access token resolution order:
 *  1. Authorization: Bearer <token>
 *  2. our own sb-access-token cookie (set by POST /api/v1/auth/login)
 *  3. the @supabase/ssr session cookie the Next.js app stores in the browser
 *     (sb-<project-ref>-auth-token) — optionally chunked (.0, .1, …) and/or
 *     base64- prefixed
 */
export function extractAccessToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    const token = header.slice("Bearer ".length).trim();
    if (token) return token;
  }
  return tokenFromSupabaseCookies(req.cookies as Record<string, string> | undefined);
}

export function tokenFromSupabaseCookies(cookies: Record<string, string> | undefined): string | null {
  if (!cookies) return null;

  const direct = cookies["sb-access-token"];
  if (direct) return direct;

  let whole: string | undefined;
  const chunks = new Map<number, string>();
  for (const [name, value] of Object.entries(cookies)) {
    const match = /^sb-.+-auth-token(?:\.(\d+))?$/.exec(name);
    if (!match) continue;
    if (match[1] === undefined) {
      whole = value;
    } else {
      chunks.set(Number(match[1]), value);
    }
  }

  const raw =
    whole ??
    (chunks.size > 0
      ? [...chunks.keys()]
          .sort((a, b) => a - b)
          .map((index) => chunks.get(index) ?? "")
          .join("")
      : undefined);
  if (!raw) return null;

  const json = raw.startsWith("base64-") ? Buffer.from(raw.slice("base64-".length), "base64").toString("utf8") : raw;
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === "object" && "access_token" in parsed) {
      const token = (parsed as { access_token: unknown }).access_token;
      if (typeof token === "string" && token) return token;
    }
  } catch {
    // Malformed cookie — treat as unauthenticated.
  }
  return null;
}
