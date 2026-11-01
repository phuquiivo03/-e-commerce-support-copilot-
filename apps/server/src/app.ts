import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { corsOrigins, env } from "./config/env";
import { errorMiddleware, ok } from "./lib/errors";
import { requestContext } from "./middleware/request-context";
import { authRouter } from "./modules/auth/auth.routes";

/**
 * Builds the Express app. Routers mount under /api/v1 as modules land
 * (auth, tickets, orders, ...). Kept separate from server.ts so tests can
 * import and drive the app with supertest without binding a port.
 */
export function createApp(): express.Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    cors({
      origin: corsOrigins,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(requestContext);

  app.get("/health", (_req, res) => {
    ok(res, { status: "ok", environment: env.NODE_ENV, uptimeSeconds: Math.round(process.uptime()), time: new Date().toISOString() });
  });

  const generalLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: "RATE_LIMITED", message: "Too many requests — please slow down" } },
  });

  const authLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: "RATE_LIMITED", message: "Too many auth attempts — please wait a moment" } },
  });

  app.use("/api/v1", generalLimiter);
  app.use("/api/v1/auth", authLimiter, authRouter);
  // Future routers: app.use("/api/v1/tickets", requireAuth, ticketsRouter); etc.

  // Unmatched routes get the JSON envelope instead of Express's default HTML 404.
  app.use((req, res) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: `No route for ${req.method} ${req.path}` } });
  });

  app.use(errorMiddleware);

  return app;
}
