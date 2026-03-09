import { useState, useEffect, useCallback, useRef } from "react"
import { searchEmails } from "@/api/client"
import { getListCache, setListCache } from "@/lib/list-cache"
import type { GmailMessage } from "@/types"

type EmailCache = { messages: GmailMessage[]; nextPageToken: string | null }

export function useEmails(query = "in:inbox is:important OR is:starred", enabled = true) {
  const cacheKey = `emails:${query}`
  const cached = getListCache<EmailCache>(cacheKey)
  const [messages, setMessages] = useState<GmailMessage[]>(cached?.messages ?? [])
  const [loading, setLoading] = useState(!cached && enabled)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nextPageToken = useRef<string | null>(cached?.nextPageToken ?? null)
  const currentQuery = useRef(query)
  const loadingMoreRef = useRef(false)

  const fetch = useCallback(async () => {
    currentQuery.current = query
    const key = `emails:${query}`
    if (!getListCache(key)) setLoading(true)
    setError(null)
    nextPageToken.current = null
    try {
      const result = await searchEmails(query)
      if (currentQuery.current === query) {
        setMessages(result.messages)
        nextPageToken.current = result.nextPageToken
        setListCache(key, { messages: result.messages, nextPageToken: result.nextPageToken })
      }
    } catch (err: any) {
      if (currentQuery.current === query) setError(err.message)
    } finally {
      if (currentQuery.current === query) setLoading(false)
    }
  }, [query])

  useEffect(() => {
    if (enabled) fetch()
  }, [fetch, enabled])

  useEffect(() => {
    if (!enabled) return
    window.addEventListener("focus", fetch)
    return () => window.removeEventListener("focus", fetch)
  }, [fetch, enabled])

  const loadMore = useCallback(async () => {
    if (!nextPageToken.current || loadingMoreRef.current) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    try {
      const result = await searchEmails(query, 50, nextPageToken.current)
      setMessages((prev) => {
        const next = [...prev, ...result.messages]
        setListCache(`emails:${query}`, { messages: next, nextPageToken: result.nextPageToken })
        return next
      })
      nextPageToken.current = result.nextPageToken
    } catch (err: any) {
      console.error("Failed to load more emails:", err)
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [query])

  const hasMore = nextPageToken.current !== null

  return { messages, loading, loadingMore, error, refresh: fetch, loadMore, hasMore }
}
