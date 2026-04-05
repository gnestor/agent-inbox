/**
 * In-memory fixed-window rate limiter middleware for Hono.
 *
 * Single-instance: this stores counts in process memory. If the server is
 * horizontally scaled, swap this for a shared-store implementation (Redis).
 */
import type { Context, MiddlewareHandler } from "hono"
import { createLogger } from "./logger.js"

const log = createLogger("rate-limit")

interface Bucket {
  count: number
  resetAt: number
}

export interface RateLimitOptions {
  /** Window duration in milliseconds. */
  windowMs: number
  /** Max requests allowed per key in the window. */
  max: number
  /** Compute the rate-limit key. Defaults to IP address. */
  keyFn?: (c: Context) => string
  /** Human-readable label for logging (e.g. "auth-callback"). */
  label?: string
}

/**
 * Extract client IP from common forwarding headers, falling back to the raw
 * socket address. Honors the first entry in x-forwarded-for.
 */
export function getClientIp(c: Context): string {
  const fwd = c.req.header("x-forwarded-for")
  if (fwd) {
    const first = fwd.split(",")[0]?.trim()
    if (first) return first
  }
  const real = c.req.header("x-real-ip")
  if (real) return real.trim()
  // Hono doesn't expose raw socket; fall back to a constant so same-host requests
  // in tests/dev still get keyed consistently.
  return "unknown"
}

export function createRateLimitStore() {
  const buckets = new Map<string, Bucket>()

  function hit(key: string, windowMs: number, max: number, now = Date.now()): { allowed: boolean; retryAfterSec: number; remaining: number } {
    const bucket = buckets.get(key)
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs })
      return { allowed: true, retryAfterSec: 0, remaining: max - 1 }
    }
    if (bucket.count >= max) {
      return { allowed: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000), remaining: 0 }
    }
    bucket.count += 1
    return { allowed: true, retryAfterSec: 0, remaining: max - bucket.count }
  }

  function reap(now = Date.now()): number {
    let removed = 0
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) {
        buckets.delete(key)
        removed += 1
      }
    }
    return removed
  }

  function size(): number {
    return buckets.size
  }

  function clear(): void {
    buckets.clear()
  }

  return { hit, reap, size, clear }
}

// Shared store used by rateLimit() — one per process
const defaultStore = createRateLimitStore()

// Periodic reaper (unref'd so it doesn't block shutdown)
const reaperInterval = setInterval(() => defaultStore.reap(), 60_000)
if (typeof reaperInterval.unref === "function") reaperInterval.unref()

/**
 * Create a rate-limiting middleware. Each invocation gets its own label and
 * limits, but they share a single in-memory store keyed by a prefix.
 */
export function rateLimit(opts: RateLimitOptions): MiddlewareHandler {
  const { windowMs, max, keyFn = getClientIp, label = "rl" } = opts

  return async (c, next) => {
    const key = `${label}:${keyFn(c)}`
    const { allowed, retryAfterSec, remaining } = defaultStore.hit(key, windowMs, max)

    c.header("X-RateLimit-Limit", String(max))
    c.header("X-RateLimit-Remaining", String(Math.max(0, remaining)))

    if (!allowed) {
      log.warn("Rate limit exceeded", { label, key, retryAfterSec })
      c.header("Retry-After", String(retryAfterSec))
      return c.json({ error: "Too many requests" }, 429)
    }

    await next()
  }
}

/** Exported for tests — replaces the shared store's backing Map. */
export function _getDefaultStore() {
  return defaultStore
}
