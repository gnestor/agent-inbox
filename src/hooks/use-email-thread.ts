import { useQuery } from "@tanstack/react-query"
import { getEmailThread } from "@/api/client"

export function useEmailThread(threadId: string | undefined) {
  const { data: thread, isLoading: loading, error } = useQuery({
    queryKey: ["thread", threadId],
    queryFn: () => getEmailThread(threadId!),
    enabled: !!threadId,
  })
  return {
    thread: thread ?? null,
    loading,
    error: error?.message ?? null,
  }
}
