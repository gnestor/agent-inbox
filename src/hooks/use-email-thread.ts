import { useState, useEffect } from "react"
import { getEmailThread } from "@/api/client"
import type { GmailThread } from "@/types"

export function useEmailThread(threadId: string | undefined) {
  const [thread, setThread] = useState<GmailThread | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!threadId) {
      setThread(null)
      return
    }

    setLoading(true)
    setError(null)

    getEmailThread(threadId)
      .then(setThread)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [threadId])

  return { thread, loading, error }
}
