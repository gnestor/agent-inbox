import { useQuery } from "@tanstack/react-query"
import { getEmailThread } from "@/api/client"

export function useEmailThread(threadId: string | undefined) {
  const { data: thread, isLoading: loading, error } = useQuery({
    queryKey: ["thread", threadId],
    queryFn: () => getEmailThread(threadId!),
    enabled: !!threadId,
    staleTime: 0, // Show cached data immediately, refetch in background (stale-while-revalidate)
    placeholderData: (prev: any) => prev, // Keep previous data visible during refetch
  })
  return {
    thread: thread ?? undefined,
    loading,
    error: error?.message ?? null,
  }
}
