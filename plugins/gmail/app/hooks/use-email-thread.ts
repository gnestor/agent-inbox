import { useQuery } from "@tanstack/react-query"
import { getEmailThread } from "@/api/client"
import type { GmailThread } from "../types"

export function useEmailThread(threadId: string | undefined) {
  const { data: thread, isLoading: loading, error } = useQuery<GmailThread>({
    queryKey: ["plugin-item", "gmail", threadId],
    queryFn: () => getEmailThread(threadId!) as Promise<GmailThread>,
    enabled: !!threadId,
    refetchOnMount: true,
  })
  return {
    thread: thread ?? undefined,
    loading,
    error: error?.message ?? null,
  }
}
