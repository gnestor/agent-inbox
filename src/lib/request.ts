/**
 * Shared HTTP request helper for the inbox client.
 * Used by both built-in hooks and plugin components.
 *
 * GET requests are cached in IndexedDB via idb-keyval. The cache is
 * stale-while-revalidate: cached data is returned immediately, and a
 * fresh fetch runs in the background to update the cache.
 */

import { get, set } from "idb-keyval"

const BASE = "/api"
const CACHE_PREFIX = "api:"

async function fetchFromNetwork<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API ${res.status}: ${text}`)
  }
  return res.json()
}

/**
 * Make an API request. GET requests use stale-while-revalidate from IndexedDB.
 * Non-GET requests bypass the cache entirely.
 */
export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const method = options?.method ?? "GET"
  const url = `${BASE}${path}`

  if (import.meta.env.DEV) {
    console.log(`[api] ${method} ${path}`)
  }

  // Only cache GET requests
  if (method !== "GET") {
    return fetchFromNetwork<T>(url, options)
  }

  const cacheKey = `${CACHE_PREFIX}${path}`

  // Try cache first
  try {
    const cached = await get<{ data: T; ts: number }>(cacheKey)
    if (cached?.data !== undefined) {
      // Return cached data immediately, revalidate in background
      fetchFromNetwork<T>(url, options)
        .then((fresh) => set(cacheKey, { data: fresh, ts: Date.now() }))
        .catch(() => {}) // silent background refresh failure
      return cached.data
    }
  } catch {
    // IndexedDB error — fall through to network
  }

  // No cache — fetch from network and cache the result
  const data = await fetchFromNetwork<T>(url, options)
  set(cacheKey, { data, ts: Date.now() }).catch(() => {})
  return data
}
