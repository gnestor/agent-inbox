import { useQuery } from "@tanstack/react-query"
import { getPlugins, queryPluginItems, queryPluginSubItems } from "@/api/client"

export function usePlugins() {
  return useQuery({
    queryKey: ["plugins"],
    queryFn: () => getPlugins(),
    staleTime: 0,
    refetchOnMount: true,
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
