import { useState, useEffect, useCallback } from "react"
import { getSessions } from "@/api/client"
import { getListCache, setListCache } from "@/lib/list-cache"
import type { Session } from "@/types"

export function useSessions(
  filters?: {
    status?: string
    triggerSource?: string
    project?: string
  },
  enabled = true,
) {
  const filterKey = JSON.stringify(filters)
  const cacheKey = `sessions:${filterKey}`
  const cached = getListCache<Session[]>(cacheKey)
  const [sessions, setSessions] = useState<Session[]>(cached ?? [])
  const [loading, setLoading] = useState(!cached && enabled)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    const key = `sessions:${filterKey}`
    if (!getListCache(key)) setLoading(true)
    setError(null)
    try {
      const result = await getSessions(filters)
      setSessions(result.sessions)
      setListCache(key, result.sessions)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [filterKey])

  useEffect(() => {
    if (enabled) fetch()
  }, [fetch, enabled])

  useEffect(() => {
    if (!enabled) return
    window.addEventListener("focus", fetch)
    return () => window.removeEventListener("focus", fetch)
  }, [fetch, enabled])

  return { sessions, loading, error, refresh: fetch }
}
