import { QueryClient } from "@tanstack/react-query"

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,              // Show cached data instantly, refetch in background (stale-while-revalidate)
      gcTime: 24 * 60 * 60_000, // 24h — must match or exceed persister maxAge
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})
