import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { getSessions } from "@/api/client"
import type { Session } from "@/types"

interface SessionFilters {
  status?: string
  triggerSource?: string
  project?: string
  q?: string
}

export function useSessions(filters?: SessionFilters, options?: { enabled?: boolean; refetchInterval?: number | false }) {
  const result = useQuery({
    queryKey: ["sessions", filters],
    queryFn: () => getSessions(filters).then((r) => r.sessions),
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval,
  })
  return {
    sessions: result.data ?? [],
    // isPending stays true until first data arrives (no empty state flash)
    // isLoading would briefly be false between mount and fetch start
    loading: (options?.enabled === false) ? false : result.isPending,
    error: result.error?.message ?? null,
    refresh: () => result.refetch(),
  }
}

const ONE_DAY_MS = 86_400_000

export function isRecentSession(session: Session): boolean {
  if (session.status === "archived") return false
  if (session.status === "running" || session.status === "awaiting_user_input") return true
  const ref = session.completedAt ?? session.updatedAt
  return Date.now() - new Date(ref).getTime() < ONE_DAY_MS
}

/**
 * Single source of truth for recent sessions.
 * Both the sidebar and the tab container derive from this.
 */
export function useRecentSessions() {
  const { sessions, loading } = useSessions(undefined, { refetchInterval: 5_000 })
  const recent = useMemo(
    () => sessions.filter(isRecentSession).slice(0, 10),
    [sessions],
  )
  return { recent, loading }
}
