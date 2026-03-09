import { useState, useEffect, useCallback, useRef } from "react"
import { getTasks } from "@/api/client"
import { getListCache, setListCache } from "@/lib/list-cache"
import type { NotionTask } from "@/types"

type TaskCache = { tasks: NotionTask[]; nextCursor: string | null }

export function useTasks(
  filters?: {
    status?: string
    tags?: string
    assignee?: string
    priority?: string
  },
  enabled = true,
) {
  const filterKey = JSON.stringify(filters)
  const cacheKey = `tasks:${filterKey}`
  const cached = getListCache<TaskCache>(cacheKey)
  const [tasks, setTasks] = useState<NotionTask[]>(cached?.tasks ?? [])
  const [loading, setLoading] = useState(!cached && enabled)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nextCursor = useRef<string | null>(cached?.nextCursor ?? null)
  const loadingMoreRef = useRef(false)

  const fetch = useCallback(async () => {
    const key = `tasks:${filterKey}`
    if (!getListCache(key)) setLoading(true)
    setError(null)
    nextCursor.current = null
    try {
      const result = await getTasks(filters)
      setTasks(result.tasks)
      nextCursor.current = result.nextCursor
      setListCache(key, { tasks: result.tasks, nextCursor: result.nextCursor })
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

  const loadMore = useCallback(async () => {
    if (!nextCursor.current || loadingMoreRef.current) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    try {
      const result = await getTasks({ ...filters, cursor: nextCursor.current })
      setTasks((prev) => {
        const next = [...prev, ...result.tasks]
        setListCache(`tasks:${filterKey}`, { tasks: next, nextCursor: result.nextCursor })
        return next
      })
      nextCursor.current = result.nextCursor
    } catch (err: any) {
      console.error("Failed to load more tasks:", err)
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [filterKey])

  const hasMore = nextCursor.current !== null

  return { tasks, loading, loadingMore, error, refresh: fetch, loadMore, hasMore }
}
