import { useQuery } from "@tanstack/react-query"
import { getPlugins, queryPluginItems } from "@/api/client"

export function usePlugins() {
  return useQuery({
    queryKey: ["plugins"],
    queryFn: () => getPlugins(),
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
