import { useState, useEffect, useCallback } from "react"
import { getSessions } from "@/api/client"
import type { Session } from "@/types"

export function useSessions(filters?: {
  status?: string
  triggerSource?: string
  project?: string
}) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const filterKey = JSON.stringify(filters)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await getSessions(filters)
      setSessions(result.sessions)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [filterKey])

  useEffect(() => {
    fetch()
  }, [fetch])

  return { sessions, loading, error, refresh: fetch }
}
