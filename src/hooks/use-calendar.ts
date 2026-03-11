import { useInfiniteQuery } from "@tanstack/react-query"
import { getCalendarItems } from "@/api/client"

interface CalendarFilters {
  status?: string
  tags?: string
  assignee?: string
}

export function useCalendar(filters?: CalendarFilters, enabled = true) {
  const result = useInfiniteQuery({
    queryKey: ["calendar", filters],
    queryFn: ({ pageParam }) => getCalendarItems({ ...filters, cursor: pageParam as string | undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled,
  })
  const items = result.data?.pages.flatMap((p) => p.items) ?? []
  return {
    items,
    loading: result.isLoading,
    loadingMore: result.isFetchingNextPage,
    error: result.error?.message ?? null,
    refresh: () => result.refetch(),
    loadMore: () => result.fetchNextPage(),
    hasMore: result.hasNextPage,
  }
}
