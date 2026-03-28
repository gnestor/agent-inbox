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

// Reuse a single DB connection for all reads/writes (avoids repeated open())
let dbInstance: IDBDatabase | null = null
const dbReady: Promise<IDBDatabase | null> = new Promise((resolve) => {
  try {
    const req = indexedDB.open("keyval-store")
    req.onsuccess = () => { dbInstance = req.result; resolve(req.result) }
    req.onerror = () => resolve(null)
  } catch { resolve(null) }
})

// Direct IndexedDB access using shared connection
async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = dbInstance ?? await dbReady
  if (!db) return undefined
  return new Promise((resolve) => {
    try {
      const tx = db.transaction("keyval", "readonly")
      const getReq = tx.objectStore("keyval").get(key)
      getReq.onsuccess = () => resolve(getReq.result as T | undefined)
      getReq.onerror = () => resolve(undefined)
    } catch { resolve(undefined) }
  })
}

function idbSet(key: string, value: unknown): void {
  const db = dbInstance
  if (!db) { dbReady.then((d) => { if (d) idbSetDirect(d, key, value) }); return }
  idbSetDirect(db, key, value)
}

function idbSetDirect(db: IDBDatabase, key: string, value: unknown): void {
  try {
    const tx = db.transaction("keyval", "readwrite")
    tx.objectStore("keyval").put(value, key)
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

  // Skip cache for non-GET requests and auth endpoints (always check server)
  if (method !== "GET" || path.startsWith("/auth/")) {
    return fetchFromNetwork<T>(url, options)
  }

  const cacheKey = `${CACHE_PREFIX}${path}`

  // 1. In-memory cache (instant)
  const mem = memCache.get(cacheKey) as T | undefined
  if (mem !== undefined) {
    console.log(`[cache] HIT mem ${path}`)
    fetchFromNetwork<T>(url, options)
      .then((fresh) => { memCache.set(cacheKey, fresh); idbSet(cacheKey, fresh) })
      .catch(() => {})
    return mem
  }

  // 2. IndexedDB cache (fast async)
  try {
    const t0 = performance.now()
    const cached = await idbGet<T>(cacheKey)
    const dt = performance.now() - t0
    if (cached !== undefined && cached !== null) {
      console.log(`[cache] HIT idb ${path} (${dt.toFixed(0)}ms)`)
      memCache.set(cacheKey, cached)
      fetchFromNetwork<T>(url, options)
        .then((fresh) => { memCache.set(cacheKey, fresh); idbSet(cacheKey, fresh) })
        .catch(() => {})
      return cached
    }
    console.log(`[cache] MISS ${path} (idb read ${dt.toFixed(0)}ms)`)
  } catch {
    console.log(`[cache] ERROR ${path}`)
  }

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
