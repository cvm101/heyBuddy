/**
 * Tiny structured logger.
 *
 * - Always writes to console with a [source] prefix and JSON context.
 * - On error level, additionally POSTs to /api/log to persist into app_logs.
 *
 * Use from any boundary that can fail (auth, realtime, geolocation, db).
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  [k: string]: unknown;
}

function fmt(level: LogLevel, source: string, message: string, ctx?: LogContext) {
  const ts = new Date().toISOString();
  const ctxStr = ctx && Object.keys(ctx).length ? " " + safeStringify(ctx) : "";
  return `[${ts}] [${level.toUpperCase()}] [${source}] ${message}${ctxStr}`;
}

function safeStringify(v: unknown) {
  try {
    return JSON.stringify(v, (_k, val) => {
      if (val instanceof Error) {
        return { name: val.name, message: val.message, stack: val.stack };
      }
      return val;
    });
  } catch {
    return String(v);
  }
}

async function persist(level: LogLevel, source: string, message: string, ctx?: LogContext) {
  // Only attempt persistence in the browser; on the server we have console only.
  if (typeof window === "undefined") return;
  try {
    await fetch("/api/log", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ level, source, message, context: ctx ?? null }),
      // Don't block UI; fire-and-forget is fine.
      keepalive: true,
    });
  } catch (e) {
    // Last-resort: just log locally; do not throw from the logger.
    // eslint-disable-next-line no-console
    console.warn("[logger] failed to POST /api/log", e);
  }
}

export const logger = {
  debug(source: string, message: string, ctx?: LogContext) {
    // eslint-disable-next-line no-console
    console.debug(fmt("debug", source, message, ctx));
  },
  info(source: string, message: string, ctx?: LogContext) {
    // eslint-disable-next-line no-console
    console.info(fmt("info", source, message, ctx));
  },
  warn(source: string, message: string, ctx?: LogContext) {
    // eslint-disable-next-line no-console
    console.warn(fmt("warn", source, message, ctx));
  },
  error(source: string, message: string, ctx?: LogContext) {
    // eslint-disable-next-line no-console
    console.error(fmt("error", source, message, ctx));
    void persist("error", source, message, ctx);
  },
};
