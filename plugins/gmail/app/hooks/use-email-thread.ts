import { useQuery, useQueryClient } from "@tanstack/react-query"
import { getEmailThread } from "@/api/client"

export function useEmailThread(threadId: string | undefined) {
  const qc = useQueryClient()
  const { data: thread, isLoading: loading, error } = useQuery({
    queryKey: ["thread", threadId],
    queryFn: () => getEmailThread(threadId!),
    enabled: !!threadId,
    staleTime: 5 * 60 * 1000, // Fresh for 5min — no refetch on re-mount within this window
    gcTime: 30 * 60 * 1000, // Keep in memory for 30min after last use
    initialData: () => {
      // Instant display from cache if available (no loading state)
      return threadId ? qc.getQueryData(["thread", threadId]) as any : undefined
    },
  })
  return {
    thread: thread ?? undefined,
    loading,
    error: error?.message ?? null,
  }
}
