import { QueryClient } from "@tanstack/react-query"

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,       // Never auto-refetch within a session
      gcTime: 24 * 60 * 60_000, // 24h — must match or exceed persister maxAge
      retry: 1,
      refetchOnWindowFocus: false, // Only refetch on load or manual pull-to-refresh
      refetchOnMount: false,       // Tab switches don't trigger refetches
    },
  },
})
