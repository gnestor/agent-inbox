/**
 * Shared HTTP request helper for the inbox client.
 * Used by both built-in hooks and plugin components.
 *
 * GET requests are cached in IndexedDB via idb-keyval. The cache is
 * stale-while-revalidate: cached data is returned immediately, and a
 * fresh fetch runs in the background to update the cache.
 */

const BASE = "/api"
const CACHE_PREFIX = "api:"

// In-memory cache (survives within a session, instant access)
const memCache = new Map<string, unknown>()

// Direct IndexedDB access (avoids idb-keyval import issues)
function idbGet<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open("keyval-store")
      req.onsuccess = () => {
        const db = req.result
        try {
          const tx = db.transaction("keyval", "readonly")
          const store = tx.objectStore("keyval")
          const getReq = store.get(key)
          getReq.onsuccess = () => resolve(getReq.result as T | undefined)
          getReq.onerror = () => resolve(undefined)
        } catch { resolve(undefined) }
      }
      req.onerror = () => resolve(undefined)
    } catch { resolve(undefined) }
  })
}

function idbSet(key: string, value: unknown): void {
  try {
    const req = indexedDB.open("keyval-store")
    req.onsuccess = () => {
      const db = req.result
      try {
        const tx = db.transaction("keyval", "readwrite")
        const store = tx.objectStore("keyval")
        store.put(value, key)
      } catch {}
    }
  } catch {}
}

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
 * Make an API request. GET requests use stale-while-revalidate:
 * 1. Check in-memory cache (instant, <1ms)
 * 2. Check IndexedDB cache (async, ~5ms)
 * 3. Fetch from network (async, 100ms-4s)
 *
 * Cache hits return immediately. Background fetch updates both caches.
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

  // 1. In-memory cache (instant)
  const mem = memCache.get(cacheKey) as T | undefined
  if (mem !== undefined) {
    // Revalidate in background
    fetchFromNetwork<T>(url, options)
      .then((fresh) => {
        memCache.set(cacheKey, fresh)
        idbSet(cacheKey, fresh)
      })
      .catch(() => {})
    return mem
  }

  // 2. IndexedDB cache (fast async)
  try {
    const cached = await idbGet<T>(cacheKey)
    if (cached !== undefined && cached !== null) {
      memCache.set(cacheKey, cached)
      // Revalidate in background
      fetchFromNetwork<T>(url, options)
        .then((fresh) => {
          memCache.set(cacheKey, fresh)
          idbSet(cacheKey, fresh)
        })
        .catch(() => {})
      return cached
    }
  } catch {}

  // 3. Network fetch (slow)
  const data = await fetchFromNetwork<T>(url, options)
  memCache.set(cacheKey, data)
  idbSet(cacheKey, data)
  return data
}

/** Invalidate a cached path (call after mutations) */
export function invalidateCache(pathPrefix: string) {
  const prefix = `${CACHE_PREFIX}${pathPrefix}`
  for (const key of memCache.keys()) {
    if (key.startsWith(prefix)) memCache.delete(key)
  }
}
