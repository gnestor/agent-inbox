import { useQuery } from "@tanstack/react-query"
import { getEmailThread } from "@/api/client"

export function useEmailThread(threadId: string | undefined) {
  const { data: thread, isLoading: loading, error } = useQuery({
    queryKey: ["thread", threadId],
    queryFn: () => getEmailThread(threadId!),
    enabled: !!threadId,
    staleTime: 5 * 60 * 1000, // 5 minutes — cached thread data is reused, not refetched on every mount
  })
  return {
    thread: thread ?? undefined,
    loading,
    error: error?.message ?? null,
  }
}
