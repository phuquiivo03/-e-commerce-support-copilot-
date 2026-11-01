import type { UserRole } from "@copilot/shared";
import type { RequestHandler } from "express";
import { ApiError } from "../lib/errors";

/**
 * Role allowlist middleware. Must run after requireAuth (401 without
 * req.auth, 403 when the profile role is not in the allowlist).
 */
export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) {
      next(new ApiError(401, "UNAUTHENTICATED", "Authentication required."));
      return;
    }
    if (!roles.includes(req.auth.role)) {
      next(new ApiError(403, "FORBIDDEN", "Your role does not permit this action."));
      return;
    }
    next();
  };
}
