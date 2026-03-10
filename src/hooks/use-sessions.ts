import { useQuery } from "@tanstack/react-query"
import { getSessions } from "@/api/client"

interface SessionFilters {
  status?: string
  triggerSource?: string
  project?: string
}

export function useSessions(filters?: SessionFilters, enabled = true) {
  const result = useQuery({
    queryKey: ["sessions", filters],
    queryFn: () => getSessions(filters).then((r) => r.sessions),
    enabled,
    refetchOnMount: true, // refetch when stale (e.g. after invalidation from session create/abort)
  })
  return {
    sessions: result.data ?? [],
    loading: result.isLoading,
    error: result.error?.message ?? null,
    refresh: () => result.refetch(),
  }
}
