import { useQuery } from "@tanstack/react-query"
import { getEmailThread } from "../api"

export function useEmailThread(threadId: string | undefined) {
  const { data: thread, isLoading, error } = useQuery({
    queryKey: ["plugin-item", "gmail", threadId],
    queryFn: () => getEmailThread(threadId!),
    enabled: !!threadId,
    staleTime: 0,
  })
  return {
    thread: thread ?? undefined,
    loading: isLoading,
    error: error?.message ?? null,
  }
}
