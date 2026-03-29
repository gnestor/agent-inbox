import { QueryClient } from "@tanstack/react-query"

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,  // 5min — cached data renders instantly, no refetch flash
      gcTime: 24 * 60 * 60_000, // 24h — must match or exceed persister maxAge
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})
