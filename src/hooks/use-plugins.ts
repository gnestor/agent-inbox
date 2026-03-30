import { useQuery } from "@tanstack/react-query"
import { getPlugins, queryPluginItems, queryPluginSubItems, getPluginItem } from "@/api/client"
import { useWorkspaceId } from "@/hooks/use-user"

export function usePlugins() {
  const wsId = useWorkspaceId()
  return useQuery({
    queryKey: ["plugins", wsId],
    queryFn: () => getPlugins(),
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
  cursor?: string,
  enabled = true,
) {
  const wsId = useWorkspaceId()
  return useQuery({
    queryKey: ["plugin-items", wsId, sourceId, filters, cursor],
    queryFn: () => queryPluginItems(sourceId, filters, cursor),
    enabled: enabled && !!sourceId,
  })
}

export function usePluginItem(
  pluginId: string,
  itemId: string,
  enabled = true,
) {
  const wsId = useWorkspaceId()
  return useQuery({
    queryKey: ["plugin-item", wsId, pluginId, itemId],
    queryFn: () => getPluginItem(pluginId, itemId),
    enabled: enabled && !!pluginId && !!itemId,
  })
}

export function usePluginSubItems(
  sourceId: string,
  itemId: string,
  filters: Record<string, string> = {},
  cursor?: string,
  enabled = true,
) {
  const wsId = useWorkspaceId()
  return useQuery({
    queryKey: ["plugin-subitems", wsId, sourceId, itemId, filters, cursor],
    queryFn: () => queryPluginSubItems(sourceId, itemId, filters, cursor),
    enabled: enabled && !!sourceId && !!itemId,
  })
}
