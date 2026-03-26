import { useQuery } from "@tanstack/react-query"
import { getPlugins, queryPluginItems, queryPluginSubItems } from "@/api/client"

export function usePlugins() {
  return useQuery({
    queryKey: ["plugins"],
    queryFn: () => getPlugins(),
    staleTime: 30_000,
    gcTime: 60_000,
    refetchOnMount: "always",
    // Treat empty arrays from stale cache as placeholder — always refetch
    placeholderData: (prev) => prev,
    refetchInterval: (query) => {
      const data = query.state.data
      if (!data || data.length === 0) {
        // Stop polling after ~30 seconds (15 attempts × 2s) of empty results
        const fetchCount = query.state.dataUpdateCount
        return fetchCount < 15 ? 2000 : false
      }
      return false
    },
  })
}

export function usePluginItems(
  sourceId: string,
  filters: Record<string, string>,
  cursor?: string
) {
  return useQuery({
    queryKey: ["plugin-items", sourceId, filters, cursor],
    queryFn: () => queryPluginItems(sourceId, filters, cursor),
    enabled: !!sourceId,
  })
}

export function usePluginSubItems(
  sourceId: string,
  itemId: string,
  filters: Record<string, string> = {},
  cursor?: string
) {
  return useQuery({
    queryKey: ["plugin-subitems", sourceId, itemId, filters, cursor],
    queryFn: () => queryPluginSubItems(sourceId, itemId, filters, cursor),
    enabled: !!sourceId && !!itemId,
  })
}
