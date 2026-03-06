import { useState, useEffect, useCallback, useRef } from "react"
import { getTasks } from "@/api/client"
import type { NotionTask } from "@/types"

export function useTasks(filters?: {
  status?: string
  tags?: string
  assignee?: string
  priority?: string
}) {
  const [tasks, setTasks] = useState<NotionTask[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nextCursor = useRef<string | null>(null)

  const filterKey = JSON.stringify(filters)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    nextCursor.current = null
    try {
      const result = await getTasks(filters)
      setTasks(result.tasks)
      nextCursor.current = result.nextCursor
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [filterKey])

  useEffect(() => {
    fetch()
  }, [fetch])

  const loadMore = useCallback(async () => {
    if (!nextCursor.current || loadingMore) return
    setLoadingMore(true)
    try {
      const result = await getTasks({ ...filters, cursor: nextCursor.current })
      setTasks((prev) => [...prev, ...result.tasks])
      nextCursor.current = result.nextCursor
    } catch (err: any) {
      console.error("Failed to load more tasks:", err)
    } finally {
      setLoadingMore(false)
    }
  }, [filterKey, loadingMore])

  const hasMore = nextCursor.current !== null

  return { tasks, loading, loadingMore, error, refresh: fetch, loadMore, hasMore }
}
