import { useState, useEffect, useCallback, useRef } from "react"
import { searchEmails } from "@/api/client"
import type { GmailMessage } from "@/types"

export function useEmails(query = "in:inbox is:important OR is:starred") {
  const [messages, setMessages] = useState<GmailMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nextPageToken = useRef<string | null>(null)
  const currentQuery = useRef(query)

  const fetch = useCallback(async () => {
    currentQuery.current = query
    setLoading(true)
    setError(null)
    nextPageToken.current = null
    try {
      const result = await searchEmails(query)
      if (currentQuery.current === query) {
        setMessages(result.messages)
        nextPageToken.current = result.nextPageToken
      }
    } catch (err: any) {
      if (currentQuery.current === query) setError(err.message)
    } finally {
      if (currentQuery.current === query) setLoading(false)
    }
  }, [query])

  useEffect(() => {
    fetch()
  }, [fetch])

  const loadMore = useCallback(async () => {
    if (!nextPageToken.current || loadingMore) return
    setLoadingMore(true)
    try {
      const result = await searchEmails(query, 50, nextPageToken.current)
      setMessages((prev) => [...prev, ...result.messages])
      nextPageToken.current = result.nextPageToken
    } catch (err: any) {
      console.error("Failed to load more emails:", err)
    } finally {
      setLoadingMore(false)
    }
  }, [query, loadingMore])

  const hasMore = nextPageToken.current !== null

  return { messages, loading, loadingMore, error, refresh: fetch, loadMore, hasMore }
}
