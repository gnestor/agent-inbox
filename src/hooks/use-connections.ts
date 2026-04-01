import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { getConnections, disconnectIntegration } from "@/api/client"
import { toast } from "sonner"

export function useConnections() {
  return useQuery({
    queryKey: ["connections"],
    queryFn: () => getConnections(),
    select: (data) => data.integrations,
  })
}

export function useDisconnectIntegration() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (integration: string) => disconnectIntegration(integration),
    onMutate: (integration: string) => {
      const previous = qc.getQueryData<{ integrations: any[] }>(["connections"])
      qc.setQueryData<{ integrations: any[] }>(["connections"], (old) => {
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
