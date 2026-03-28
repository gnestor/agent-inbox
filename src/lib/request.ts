/**
 * Shared HTTP request helper for the inbox client.
 * Used by both built-in hooks and plugin components.
 */

const BASE = "/api"

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const method = options?.method ?? "GET"
  if (import.meta.env.DEV) {
    console.log(`[api] ${method} ${path}`)
  }
  const start = import.meta.env.DEV ? performance.now() : 0
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  })
  if (!res.ok) {
    const text = await res.text()
    if (import.meta.env.DEV) {
      console.error(`[api] ${method} ${path} → ${res.status} (${(performance.now() - start).toFixed(0)}ms)`, text)
    }
    throw new Error(`API ${res.status}: ${text}`)
  }
  if (import.meta.env.DEV) {
    console.log(`[api] ${method} ${path} → ${res.status} (${(performance.now() - start).toFixed(0)}ms)`)
  }
  return res.json()
}
