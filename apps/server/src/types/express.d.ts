import type { AuthContext } from "@copilot/shared";
import type { Logger } from "../lib/logger";

declare global {
  namespace Express {
    interface Request {
      /** Correlation id from x-request-id (or freshly minted) — set by requestContext. */
      requestId?: string;
      /** Child logger pre-bound with requestId/method/path — set by requestContext. */
      log?: Logger;
      /** Set by requireAuth. Never trust client-supplied values: role and customerId come from the database. */
      auth?: AuthContext;
    }
  }
}

export {};
