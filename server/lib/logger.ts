/**
 * Lightweight structured logger.
 *
 * In development: human-readable prefixed output
 *   [INFO] [session] Session started sessionId=abc123
 *
 * In production (NODE_ENV=production): JSON lines for log aggregation
 *   {"level":"info","module":"session","msg":"Session started","sessionId":"abc123","ts":"..."}
 */

type LogLevel = "debug" | "info" | "warn" | "error"

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }
const MIN_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) || "info"
const IS_PROD = process.env.NODE_ENV === "production"

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[MIN_LEVEL]
}

function formatCtx(ctx?: Record<string, unknown>): string {
  if (!ctx || Object.keys(ctx).length === 0) return ""
  return " " + Object.entries(ctx).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(" ")
}

function emit(level: LogLevel, module: string, msg: string, ctx?: Record<string, unknown>) {
  if (!shouldLog(level)) return

  if (IS_PROD) {
    // JSON lines for structured log aggregation
    const entry = { level, module, msg, ...ctx, ts: new Date().toISOString() }
    const line = JSON.stringify(entry)
    if (level === "error") process.stderr.write(line + "\n")
    else process.stdout.write(line + "\n")
  } else {
    // Human-readable for development
    const tag = `[${level.toUpperCase()}] [${module}]`
    const full = `${tag} ${msg}${formatCtx(ctx)}`
    switch (level) {
      case "debug": console.debug(full); break
      case "info":  console.log(full); break
      case "warn":  console.warn(full); break
      case "error": console.error(full); break
    }
  }
}

export interface Logger {
  debug: (msg: string, ctx?: Record<string, unknown>) => void
  info:  (msg: string, ctx?: Record<string, unknown>) => void
  warn:  (msg: string, ctx?: Record<string, unknown>) => void
  error: (msg: string, ctx?: Record<string, unknown>) => void
  /** Create a child logger with additional default context. */
  child: (defaultCtx: Record<string, unknown>) => Logger
}

export function createLogger(module: string, defaultCtx?: Record<string, unknown>): Logger {
  const mergeCtx = (ctx?: Record<string, unknown>) =>
    defaultCtx ? { ...defaultCtx, ...ctx } : ctx

  return {
    debug: (msg, ctx) => emit("debug", module, msg, mergeCtx(ctx)),
    info:  (msg, ctx) => emit("info",  module, msg, mergeCtx(ctx)),
    warn:  (msg, ctx) => emit("warn",  module, msg, mergeCtx(ctx)),
    error: (msg, ctx) => emit("error", module, msg, mergeCtx(ctx)),
    child: (childCtx) => createLogger(module, { ...defaultCtx, ...childCtx }),
  }
}
