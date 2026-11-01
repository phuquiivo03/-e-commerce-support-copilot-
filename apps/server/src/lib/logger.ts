import { env } from "../config/env";

/**
 * Minimal pino-style structured logger: one JSON object per line on stdout,
 * with a numeric epoch `time`, a string `msg`, and any extra fields inlined.
 *
 * Child loggers (logger.child({...})) pre-bind fields — the request-context
 * middleware binds `requestId` per request so every line for a request
 * carries the x-request-id correlation id.
 *
 * Sensitive keys (passwords, tokens, cookies, authorization headers, API
 * keys) are redacted before serialization, so a stray credential in a logged
 * object never reaches the log sink.
 */

const LEVEL_WEIGHT = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type LogLevel = keyof typeof LEVEL_WEIGHT;

const SENSITIVE_KEY = /password|pwd|token|secret|authorization|cookie|api[-_]?key|refresh/i;

export type LogFields = Record<string, unknown>;

function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (depth > 6 || seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1, seen));
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : redact(val, depth + 1, seen);
  }
  return out;
}

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  /** Returns a logger with the given fields pre-bound onto every line. */
  child(bindings: LogFields): Logger;
}

export function createLogger(bindings: LogFields = {}): Logger {
  const threshold = LEVEL_WEIGHT[env.LOG_LEVEL];

  const emit = (level: LogLevel, msg: string, fields?: LogFields): void => {
    if (LEVEL_WEIGHT[level] < threshold) return;
    const line = JSON.stringify({
      level,
      time: Date.now(),
      msg,
      ...bindings,
      ...(fields ? (redact(fields) as LogFields) : {}),
    });
    process.stdout.write(`${line}\n`);
  };

  return {
    debug: (msg, fields) => emit("debug", msg, fields),
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
    child: (extra) => createLogger({ ...bindings, ...extra }),
  };
}

export const logger = createLogger();
