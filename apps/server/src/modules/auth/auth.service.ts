import { UserRoleSchema, type AuthSession, type AuthUser } from "@copilot/shared";
import { ApiError } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { createAnonClient, createServiceClient, createUserClient } from "../../lib/supabase";

const log = logger.child({ module: "auth" });

interface SupabaseSession {
  access_token: string;
  refresh_token?: string | null;
  token_type: string;
  expires_in: number;
  expires_at?: number | null;
}

function toAuthSession(session: SupabaseSession): AuthSession {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token ?? null,
    tokenType: session.token_type,
    expiresIn: session.expires_in,
    expiresAt: session.expires_at ?? null,
  };
}

/** Sign in with email + password via Supabase Auth, then load the profile row under the caller's identity. */
export async function login(email: string, password: string): Promise<{ session: AuthSession; user: AuthUser }> {
  const { data, error } = await createAnonClient().auth.signInWithPassword({ email, password });
  if (error || !data.session || !data.user) {
    throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid email or password.");
  }

  const client = createUserClient(data.session.access_token);
  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("id, email, full_name, role")
    .eq("id", data.user.id)
    .single();

  if (profileError || !profile) {
    throw new ApiError(401, "UNAUTHENTICATED", "Profile not found for the authenticated user.");
  }

  const role = UserRoleSchema.safeParse(profile.role);
  if (!role.success) {
    throw new ApiError(500, "INVALID_PROFILE", "Profile has an unknown role.");
  }

  return {
    session: toAuthSession(data.session),
    user: {
      id: profile.id,
      email: profile.email,
      fullName: profile.full_name ?? null,
      role: role.data,
    },
  };
}

/**
 * Revoke the session server-side with the service-role key (best effort —
 * an expired or invalid token still results in a successful logout, the
 * cookie is cleared by the route either way).
 */
export async function logout(accessToken: string | null): Promise<void> {
  if (!accessToken) return;
  try {
    await createServiceClient().auth.admin.signOut(accessToken);
  } catch (err) {
    log.warn("supabase signOut failed during logout", { error: err });
  }
}
