import { useState, useEffect } from "react"
import { getEmailThread } from "@/api/client"
import type { GmailThread } from "@/types"

const threadCache = new Map<string, GmailThread>()

export function useEmailThread(threadId: string | undefined) {
  const cached = threadId ? threadCache.get(threadId) : undefined
  const [thread, setThread] = useState<GmailThread | null>(cached ?? null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!threadId) {
      setThread(null)
      return
    }

    if (!threadCache.has(threadId)) setLoading(true)
    setError(null)

    getEmailThread(threadId)
      .then((data) => {
        setThread(data)
        threadCache.set(threadId, data)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [threadId])

  return { thread, loading, error }
}
