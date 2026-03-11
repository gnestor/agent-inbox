import { useInfiniteQuery } from "@tanstack/react-query"
import { getTasks } from "@/api/client"

interface TaskFilters {
  status?: string
  tags?: string
  assignee?: string
  priority?: string
}

export function useTasks(filters?: TaskFilters, enabled = true) {
  const result = useInfiniteQuery({
    queryKey: ["tasks", filters],
    queryFn: ({ pageParam }) => getTasks({ ...filters, cursor: pageParam as string | undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled,
    refetchOnMount: true, // refetch when stale (e.g. after IndexedDB restore invalidation)
  })
  const tasks = result.data?.pages.flatMap((p) => p.tasks) ?? []
  return {
    tasks,
    loading: result.isLoading,
    loadingMore: result.isFetchingNextPage,
    error: result.error?.message ?? null,
    refresh: () => result.refetch(),
    loadMore: () => result.fetchNextPage(),
    hasMore: result.hasNextPage,
  }
}
