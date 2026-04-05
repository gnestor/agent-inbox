/**
 * CSRF protection middleware — Origin header validation.
 *
 * For state-changing requests (POST/PUT/PATCH/DELETE), verify that the
 * Origin header (or Referer origin as fallback) matches an allowed origin.
 *
 * This is a second layer of defense on top of SameSite cookies. Browsers
 * always send an Origin header on cross-origin state-changing requests,
 * so checking it reliably prevents CSRF.
 */
import type { MiddlewareHandler } from "hono"
import { createLogger } from "./logger.js"

const log = createLogger("csrf")

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

export interface CsrfOptions {
  /** Exact origins (protocol + host + port) that are allowed. */
  allowedOrigins: string[]
  /** Path prefixes to exempt (e.g. OAuth callbacks that receive third-party redirects). */
  exemptPaths?: string[]
}

/** Extract the origin (protocol + host + port) from a URL string, or null. */
export function extractOrigin(urlString: string | undefined | null): string | null {
  if (!urlString) return null
  try {
    const url = new URL(urlString)
    return url.origin
  } catch {
    return null
  }
}

export function csrfProtection(opts: CsrfOptions): MiddlewareHandler {
  const allowed = new Set(opts.allowedOrigins)
  const exempt = opts.exemptPaths ?? []

  return async (c, next) => {
    const method = c.req.method.toUpperCase()

    // Safe methods don't need CSRF protection (per RFC 7231)
    if (SAFE_METHODS.has(method)) {
      return next()
    }

    // Exempt paths (e.g. OAuth callbacks)
    const path = c.req.path
    if (exempt.some((prefix) => path.startsWith(prefix))) {
      return next()
    }

    // Prefer Origin, fall back to Referer
    const origin = c.req.header("origin") ?? extractOrigin(c.req.header("referer"))

    if (!origin) {
      log.warn("CSRF block: missing Origin/Referer", { method, path })
      return c.json({ error: "Missing origin" }, 403)
    }

    if (!allowed.has(origin)) {
      log.warn("CSRF block: foreign Origin", { method, path, origin })
      return c.json({ error: "Forbidden origin" }, 403)
    }

    return next()
  }
}
