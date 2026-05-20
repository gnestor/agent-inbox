import { createQueryClient } from "@hammies/frontend/lib/queryClient"

// Inbox uses 5-min staleTime so cached data renders instantly without
// triggering a refetch flash. gcTime stays at 24h to keep queries hot
// across route changes within a session.
export const { queryClient } = createQueryClient({
  staleTime: 5 * 60 * 1000,
  gcTime: 24 * 60 * 60_000,
})
