import { LoginRequestSchema, type LoginResponse, type MeResponse } from "@copilot/shared";
import type { CookieOptions } from "express";
import { Router } from "express";
import { env } from "../../config/env";
import { ApiError, ok } from "../../lib/errors";
import { extractAccessToken } from "../../lib/supabase";
import { requireAuth } from "../../middleware/require-auth";
import { login, logout } from "./auth.service";

/**
 * The session cookie the API sets on login and requireAuth reads back.
 * Also compatible with the classic Supabase SSR helper cookie name.
 */
export const AUTH_COOKIE = "sb-access-token";

const authCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
};

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const parsed = LoginRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(422, "VALIDATION_ERROR", "Request body failed validation.", parsed.error.flatten());
  }

  const result: LoginResponse = await login(parsed.data.email, parsed.data.password);

  res.cookie(AUTH_COOKIE, result.session.accessToken, {
    ...authCookieOptions,
    maxAge: result.session.expiresIn * 1000,
  });
  ok(res, result);
});

authRouter.post("/logout", async (req, res) => {
  await logout(extractAccessToken(req));
  res.clearCookie(AUTH_COOKIE, authCookieOptions);
  res.status(204).send();
});

authRouter.get("/me", requireAuth, (req, res) => {
  if (!req.auth) {
    throw new ApiError(401, "UNAUTHENTICATED", "Authentication required.");
  }
  const payload: MeResponse = { user: req.auth };
  ok(res, payload);
});
