import { UserRoleSchema, type AuthContext } from "@copilot/shared";
import type { RequestHandler } from "express";
import { ApiError } from "../lib/errors";
import { createAnonClient, createUserClient, extractAccessToken } from "../lib/supabase";

/**
 * Verifies the caller's Supabase access token — taken from
 * `Authorization: Bearer` or the Supabase auth cookie — via
 * supabase.auth.getUser(token), then loads the role from the profiles table
 * with the caller's own identity (RLS: read own), mirroring
 * apps/web requireUser. The live database row is the source of truth:
 * role and customer id are never taken from client-supplied claims.
 *
 * Attaches req.auth = { userId, email, role, customerId? }.
 */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  try {
    const token = extractAccessToken(req);
    if (!token) {
      throw new ApiError(401, "UNAUTHENTICATED", "Authentication required.");
    }

    const { data, error } = await createAnonClient().auth.getUser(token);
    if (error || !data.user) {
      throw new ApiError(401, "UNAUTHENTICATED", "Invalid or expired session.");
    }

    const client = createUserClient(token);
    const { data: profile, error: profileError } = await client
      .from("profiles")
      .select("id, email, role")
      .eq("id", data.user.id)
      .single();

    if (profileError || !profile) {
      throw new ApiError(401, "UNAUTHENTICATED", "Profile not found for the authenticated user.");
    }

    const role = UserRoleSchema.safeParse(profile.role);
    if (!role.success) {
      throw new ApiError(500, "INVALID_PROFILE", "Profile has an unknown role.");
    }

    const auth: AuthContext = {
      userId: profile.id,
      email: profile.email,
      role: role.data,
    };

    // customers.profile_id is the customer identity used by orders/tickets RLS.
    if (auth.role === "CUSTOMER") {
      const { data: customer } = await client
        .from("customers")
        .select("profile_id")
        .eq("profile_id", auth.userId)
        .maybeSingle();
      if (customer) {
        auth.customerId = customer.profile_id;
      }
    }

    req.auth = auth;
    next();
  } catch (err) {
    next(err);
  }
};
