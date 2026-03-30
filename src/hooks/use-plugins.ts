import { useQuery } from "@tanstack/react-query"
import { getPlugins, queryPluginItems, queryPluginSubItems, getPluginItem } from "@/api/client"

export function usePlugins() {
  return useQuery({
    queryKey: ["plugins"],
    queryFn: () => getPlugins(),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnMount: true,
    placeholderData: (prev) => prev,
    refetchInterval: (query) => {
      const data = query.state.data
      if (!data || data.length === 0) {
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
    staleTime: 5 * 60 * 1000,
  })
}

export function usePluginItem(
  pluginId: string,
  itemId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: ["plugin-item", pluginId, itemId],
    queryFn: () => getPluginItem(pluginId, itemId),
    enabled: enabled && !!pluginId && !!itemId,
    staleTime: 5 * 60 * 1000,
  })
}

export function usePluginSubItems(
  sourceId: string,
  itemId: string,
  filters: Record<string, string> = {},
  cursor?: string,
  enabled = true,
) {
  return useQuery({
    queryKey: ["plugin-subitems", sourceId, itemId, filters, cursor],
    queryFn: () => queryPluginSubItems(sourceId, itemId, filters, cursor),
    enabled: enabled && !!sourceId && !!itemId,
  })
}
