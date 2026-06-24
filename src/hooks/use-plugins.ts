import { useMemo } from "react"
import { useQuery, useInfiniteQuery } from "@tanstack/react-query"
import { getPlugins, queryPluginItems, queryPluginSubItems, getPluginItem } from "@/api/client"
import type { PluginManifest } from "@/api/client"
import { useWorkspaceId } from "@/hooks/use-user"
import { usePreference } from "@/hooks/use-preferences"

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

/**
 * Paginated variant of usePluginItems — accumulates pages via the plugin
 * query's `nextCursor` so list views can load the full result set (the inbox
 * list otherwise stops at the first page of ~20). Pair with an infinite-scroll
 * sentinel that calls `fetchNextPage`.
 */
export function usePluginItemsInfinite(
  sourceId: string,
  filters: Record<string, string>,
  enabled = true,
) {
  const wsId = useWorkspaceId()
  return useInfiniteQuery({
    queryKey: ["plugin-items-infinite", wsId, sourceId, filters],
    queryFn: ({ pageParam }) => queryPluginItems(sourceId, filters, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
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

/** Plugins sorted by user-defined pluginOrder preference. */
export function useSortedPlugins(): PluginManifest[] {
  const { data: plugins } = usePlugins()
  const [pluginOrder] = usePreference<string[]>("pluginOrder", [])
  return useMemo(() => {
    if (!plugins) return []
    if (pluginOrder.length === 0) return plugins
    const orderMap = new Map(pluginOrder.map((id, i) => [id, i]))
    return [...plugins].sort((a, b) => {
      const ai = orderMap.get(a.id) ?? 999
      const bi = orderMap.get(b.id) ?? 999
      return ai - bi
    })
  }, [plugins, pluginOrder])
}
