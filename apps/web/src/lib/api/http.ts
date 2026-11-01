import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { UserRole } from '@copilot/shared';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export type AuthContext = {
  userId: string;
  email: string;
  role: UserRole;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
  }
}

export function jsonOk<T>(data: T, status = 200, headers?: Record<string, string>) {
  return NextResponse.json({ data }, { status, headers });
}

export function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

/**
 * Wraps a route handler with uniform error handling: known ApiErrors become
 * their status code; unknown errors are logged server-side and returned as a
 * generic 500 without internal details (no stack traces in responses).
 */
export function withErrorHandler<Args extends unknown[]>(
  handler: (...args: Args) => Promise<NextResponse>
) {
  return async (...args: Args): Promise<NextResponse> => {
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof ApiError) {
        return jsonError(error.status, error.code, error.message, error.details);
      }
      console.error('[api] unhandled error', error);
      return jsonError(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
    }
  };
}

/**
 * Authenticates the caller via the Supabase session cookie and loads their
 * role from the profiles table (live row, not JWT metadata — JWT claims can
 * be stale until refresh). Optionally enforces a role allowlist.
 */
export async function requireUser(allowedRoles?: UserRole[]): Promise<AuthContext> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, email, role')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) {
    throw new ApiError(401, 'UNAUTHENTICATED', 'Profile not found for the authenticated user.');
  }

  if (allowedRoles && !allowedRoles.includes(profile.role)) {
    throw new ApiError(403, 'FORBIDDEN', 'Your role does not permit this action.');
  }

  return { userId: profile.id, email: profile.email, role: profile.role };
}

export async function parseBody<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Request body failed validation.', parsed.error.flatten());
  }
  return parsed.data;
}

export function parsePagination(url: URL, defaultPageSize = 20, maxPageSize = 100) {
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
  const rawPageSize = Number(url.searchParams.get('pageSize') ?? String(defaultPageSize)) || defaultPageSize;
  const pageSize = Math.min(maxPageSize, Math.max(1, rawPageSize));
  return { page, pageSize, from: (page - 1) * pageSize, to: page * pageSize - 1 };
}

export function correlationId(request: Request): string {
  return request.headers.get('x-correlation-id') ?? crypto.randomUUID();
}
