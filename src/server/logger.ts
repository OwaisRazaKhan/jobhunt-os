import "server-only";

/**
 * Minimal structured JSON logger. One line per event, written to stdout/stderr
 * so any log drain (Vercel, container host, OpenTelemetry collector) can ingest it.
 * Replace the sink, not the call sites, if a vendor logger is adopted later.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogCategory = "app" | "ai" | "workflow" | "integration" | "database" | "audit";
export type LogContext = Record<string, unknown>;

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SENSITIVE_KEY =
  /pass(word)?|secret|token|authorization|cookie|api[-_]?key|credential|session|ssn|iban/i;

const REDACTED = "[REDACTED]";

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      SENSITIVE_KEY.test(key) ? REDACTED : redact(entry, depth + 1),
    ]),
  );
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  child(bindings: LogContext): Logger;
}

function resolveMinLevel(): LogLevel {
  const configured = process.env.LOG_LEVEL;
  return configured && configured in LEVEL_ORDER ? (configured as LogLevel) : "info";
}

export function createLogger(bindings: LogContext = {}): Logger {
  const write = (level: LogLevel, message: string, context?: LogContext) => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[resolveMinLevel()]) return;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      category: "app",
      message,
      ...(redact({ ...bindings, ...context }) as LogContext),
    });
    if (level === "error" || level === "warn") console.error(line);
    else console.log(line);
  };

  return {
    debug: (message, context) => write("debug", message, context),
    info: (message, context) => write("info", message, context),
    warn: (message, context) => write("warn", message, context),
    error: (message, context) => write("error", message, context),
    child: (childBindings) => createLogger({ ...bindings, ...childBindings }),
  };
}

export const logger = createLogger();
