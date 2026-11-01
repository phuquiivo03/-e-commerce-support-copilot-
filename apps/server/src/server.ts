import { env } from "./config/env";
import { pool } from "./db/pool";
import { logger } from "./lib/logger";
import { createApp } from "./app";

const log = logger.child({ module: "server" });

async function main(): Promise<void> {
  const app = createApp();
  const server = app.listen(env.PORT, () => {
    log.info(`API listening on http://localhost:${env.PORT}`, { port: env.PORT, nodeEnv: env.NODE_ENV });
  });

  const shutdown = async (signal: string) => {
    log.info(`${signal} received — shutting down`);
    server.close();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  log.error("fatal startup error", { error: err });
  process.exit(1);
});
