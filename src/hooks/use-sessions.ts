import { useQuery } from "@tanstack/react-query"
import { getSessions } from "@/api/client"

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
