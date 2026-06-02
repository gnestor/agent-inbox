import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { getConnections, disconnectIntegration } from "@/api/client"
import { toast } from "sonner"
import type { Integration } from "@/types"

type ConnectionsData = { integrations: Integration[] }

export function useConnections() {
  return useQuery({
    queryKey: ["connections"],
    queryFn: () => getConnections(),
    select: (data) => data.integrations,
    // Connection status must be authoritative, not served from the persisted
    // 5-min-stale cache. After an OAuth round-trip (which completes in a popup
    // tab), the original tab needs to reflect the new state on reload and on
    // refocus — otherwise the button keeps reading "Connect" despite success.
    // The query is also excluded from IndexedDB persistence (see main.tsx).
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  })
}

export function useDisconnectIntegration() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (integration: string) => disconnectIntegration(integration),
    onMutate: (integration: string) => {
      const previous = qc.getQueryData<ConnectionsData>(["connections"])
      qc.setQueryData<ConnectionsData>(["connections"], (old) => {
        if (!old) return old
        return {
          ...old,
          integrations: old.integrations.map((i) =>
            i.id === integration ? { ...i, connected: false } : i,
          ),
        }
      })
      return { previous }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["connections"] })
    },
    onSuccess: () => {
      toast.success("Integration disconnected")
    },
    onError: (error, _vars, context) => {
      if (context?.previous) {
        qc.setQueryData(["connections"], context.previous)
      }
      toast.error(`Failed to disconnect: ${error.message}`)
    },
  })
}
