/**
 * Persistent stale-while-revalidate cache for list views.
 * Stores data in localStorage keyed by a prefix + query key.
 * Returns cached data instantly, then the caller fetches fresh data and updates.
 */

const PREFIX = "lc:"

export function getListCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function setListCache<T>(key: string, data: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(data))
  } catch {
    // Storage full — evict oldest entries
    try {
      const keys: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k?.startsWith(PREFIX)) keys.push(k)
      }
      // Remove first half of cached keys
      for (const k of keys.slice(0, Math.ceil(keys.length / 2))) {
        localStorage.removeItem(k)
      }
      localStorage.setItem(PREFIX + key, JSON.stringify(data))
    } catch {
      /* give up */
    }
  }
}
