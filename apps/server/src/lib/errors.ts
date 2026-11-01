import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";
import { logger } from "./logger";

const log = logger.child({ module: "errors" });

/**
 * Port of apps/web/src/lib/api/http.ts (ApiError + {data}/{error} envelope)
 * to Express. Every success response is `{ data: ... }`; every failure is
 * `{ error: { code, message, details? } }`.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Success envelope. */
export function ok<T>(res: Response, data: T, status = 200): Response {
  return res.status(status).json({ data });
}

/** Failure envelope, for direct (non-thrown) error responses. */
export function fail(res: Response, status: number, code: string, message: string, details?: unknown): Response {
  return res.status(status).json({ error: { code, message, details } });
}

/** Wrap an async route handler so rejections reach the error middleware (pre-Express-5 semantics). */
export const asyncHandler =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next: NextFunction) => {
    fn(req, res).catch(next);
  };

/**
 * Uniform error handling: ApiErrors become their status code, ZodErrors a
 * 422 VALIDATION_ERROR, and anything else is logged and returned as a
 * generic 500 without internal details (no stack traces in responses).
 */
export function errorMiddleware(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApiError) {
    fail(res, err.status, err.code, err.message, err.details);
    return;
  }
  if (err instanceof ZodError) {
    fail(res, 422, "VALIDATION_ERROR", "Request body failed validation.", err.flatten());
    return;
  }
  log.error("unhandled error", { error: err });
  fail(res, 500, "INTERNAL_ERROR", "An unexpected error occurred.");
}
