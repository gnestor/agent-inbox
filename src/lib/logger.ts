/**
 * Client-side structured logger (mirror of server/lib/logger.ts).
 *
 * Use this instead of raw console.log/error/warn in client code.
 *
 * Dev mode: [LEVEL] [module] message key=value
 * Production (import.meta.env.PROD): sends structured entries to console
 * (could later be shipped to a collector).
 */

type LogLevel = "debug" | "info" | "warn" | "error"

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

// Vite exposes import.meta.env.DEV/PROD
const IS_DEV = typeof import.meta !== "undefined" && (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV !== false
const MIN_LEVEL: LogLevel = "debug"

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[MIN_LEVEL]
}

function formatCtx(ctx?: Record<string, unknown>): string {
  if (!ctx || Object.keys(ctx).length === 0) return ""
  return " " + Object.entries(ctx)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" ")
}

function emit(level: LogLevel, module: string, msg: string, ctx?: Record<string, unknown>) {
  if (!shouldLog(level)) return

  if (IS_DEV) {
    const tag = `[${level.toUpperCase()}] [${module}]`
    const full = `${tag} ${msg}${formatCtx(ctx)}`
    switch (level) {
      case "debug": console.debug(full); break
      case "info":  console.log(full); break
      case "warn":  console.warn(full); break
      case "error": console.error(full); break
    }
  } else {
    // Production: JSON entries (can be shipped to a collector)
    const entry = { level, module, msg, ...ctx, ts: new Date().toISOString() }
    const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log
    fn(JSON.stringify(entry))
  }
}

export interface Logger {
  debug: (msg: string, ctx?: Record<string, unknown>) => void
  info:  (msg: string, ctx?: Record<string, unknown>) => void
  warn:  (msg: string, ctx?: Record<string, unknown>) => void
  error: (msg: string, ctx?: Record<string, unknown>) => void
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
