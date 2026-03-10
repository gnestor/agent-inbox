import { useInfiniteQuery } from "@tanstack/react-query"
import { searchEmails } from "@/api/client"

export function useEmails(query = "in:inbox is:important OR is:starred", enabled = true) {
  const result = useInfiniteQuery({
    queryKey: ["emails", query],
    queryFn: ({ pageParam }) => searchEmails(query, 50, pageParam as string | undefined),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextPageToken ?? undefined,
    enabled,
  })
  const messages = result.data?.pages.flatMap((p) => p.messages) ?? []
  return {
    messages,
    loading: result.isLoading,
    loadingMore: result.isFetchingNextPage,
    error: result.error?.message ?? null,
    refresh: () => result.refetch(),
    loadMore: () => result.fetchNextPage(),
    hasMore: result.hasNextPage,
  }
}
