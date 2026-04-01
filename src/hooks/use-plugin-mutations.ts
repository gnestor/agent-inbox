import { useMutation, useQueryClient } from "@tanstack/react-query"
import { mutatePluginItem } from "@/api/client"
import { useWorkspaceId } from "@/hooks/use-user"
import { toast } from "sonner"
import type { PluginItem } from "@/types/plugin"

/** Map mutation actions to the optimistic field changes they produce. */
function getOptimisticPatch(action: string, payload: unknown): Record<string, unknown> | null {
  switch (action) {
    case "update-status":
      return { status: (payload as { status: string }).status }
    case "update-tags":
      return { tags: (payload as { tags: string[] }).tags }
    case "update-properties": {
      // Notion-style: { Priority: { select: { name: "High" } } } → { priority: "High" }
      const props = payload as Record<string, unknown>
      const patch: Record<string, unknown> = {}
      for (const [key, val] of Object.entries(props)) {
        const v = val as Record<string, unknown>
        if (v?.select) patch[key.toLowerCase()] = (v.select as { name: string }).name
        else patch[key.toLowerCase()] = v
      }
      return patch
    }
    case "archive":
    case "close":
      return { status: "closed" }
    case "reopen":
      return { status: "open" }
    default:
      return null
  }
}

interface PluginListData {
  items: PluginItem[]
  nextCursor?: string
}

function updateItemInList(old: PluginListData | undefined, itemId: string, patch: Record<string, unknown>): PluginListData | undefined {
  if (!old) return old
  return {
    ...old,
    items: old.items.map((item) =>
      item.id === itemId ? { ...item, ...patch } : item,
    ),
  }
}

function removeItemFromList(old: PluginListData | undefined, itemId: string): PluginListData | undefined {
  if (!old) return old
  return { ...old, items: old.items.filter((item) => item.id !== itemId) }
}

interface OptimisticContext {
  previousItems: [readonly unknown[], PluginListData | undefined][]
  previousItem: PluginItem | undefined
}

export function usePluginMutations(pluginId: string, itemId: string) {
  const qc = useQueryClient()
  const wsId = useWorkspaceId()

  const mutation = useMutation({
    mutationFn: ({ action, payload }: { action: string; payload?: unknown }) =>
      mutatePluginItem(pluginId, itemId, action, payload),

    onMutate: async ({ action, payload }): Promise<OptimisticContext> => {
      const listKey = ["plugin-items", wsId, pluginId]
      const detailKey = ["plugin-item", wsId, pluginId, itemId]

      await Promise.all([
        qc.cancelQueries({ queryKey: listKey }),
        qc.cancelQueries({ queryKey: detailKey }),
      ])

      // Save previous state
      const previousItems = qc.getQueriesData<PluginListData>({ queryKey: listKey })
      const previousItem = qc.getQueryData<PluginItem>(detailKey)

      const patch = getOptimisticPatch(action, payload)
      const isDelete = action === "delete"

      if (isDelete) {
        qc.setQueriesData<PluginListData>({ queryKey: listKey }, (old) =>
          removeItemFromList(old, itemId),
        )
        qc.setQueryData(detailKey, null)
      } else if (patch) {
        qc.setQueriesData<PluginListData>({ queryKey: listKey }, (old) =>
          updateItemInList(old, itemId, patch),
        )
        qc.setQueryData<PluginItem>(detailKey, (old) =>
          old ? { ...old, ...patch } : old,
        )
      }

      return { previousItems, previousItem }
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["plugin-items", wsId, pluginId] })
      qc.invalidateQueries({ queryKey: ["plugin-item", wsId, pluginId, itemId] })
    },

    onError: (err, { action }, context) => {
      if (context) {
        // Rollback list queries
        for (const [key, data] of context.previousItems) {
          qc.setQueryData(key, data)
        }
        // Rollback detail query
        qc.setQueryData(["plugin-item", wsId, pluginId, itemId], context.previousItem)
      }
      toast.error(`${action} failed: ${(err as Error).message}`)
    },
  })

  return {
    mutate: (action: string, payload?: unknown) => mutation.mutate({ action, payload }),
    isPending: mutation.isPending,
  }
}
