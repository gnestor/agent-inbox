import { useQuery } from "@tanstack/react-query"
import { getEmailThread } from "../api"
import type { GmailThread } from "../types"

export function useEmailThread(threadId: string | undefined) {
  const { data: thread, isLoading, error } = useQuery<GmailThread>({
    queryKey: ["plugin-item", "gmail", threadId],
    queryFn: () => getEmailThread(threadId!) as Promise<GmailThread>,
    enabled: !!threadId,
    staleTime: 0,
  })
  return {
    thread: thread ?? undefined,
    loading: isLoading,
    error: error?.message ?? null,
  }
}
