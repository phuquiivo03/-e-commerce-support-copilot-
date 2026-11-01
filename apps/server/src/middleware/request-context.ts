import { randomUUID } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { logger } from "../lib/logger";

/**
 * Correlation id + per-request child logger.
 *
 * Reads `x-request-id` from the incoming request (API gateway or caller
 * supplied) or mints a UUID, echoes it back on the response, and binds it —
 * together with method and path — to `req.log` so every log line emitted
 * while handling the request carries the correlation id.
 */
export const requestContext: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const incoming = req.headers["x-request-id"];
  const requestId = typeof incoming === "string" && incoming.trim() ? incoming.trim() : randomUUID();

  req.requestId = requestId;
  res.setHeader("x-request-id", requestId);
  req.log = logger.child({ requestId, method: req.method, path: req.originalUrl });

  const start = performance.now();
  res.on("finish", () => {
    req.log?.info("request completed", {
      status: res.statusCode,
      durationMs: Number((performance.now() - start).toFixed(1)),
    });
  });

  req.log.debug("request received");
  next();
};
