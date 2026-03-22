import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { getConnections, disconnectIntegration } from "@/api/client"
import { toast } from "sonner"

export function useConnections() {
  return useQuery({
    queryKey: ["connections"],
    queryFn: () => getConnections(),
    select: (data) => data.integrations,
    staleTime: 0,        // Always refetch — connection status can change externally (OAuth in new tab)
    refetchOnMount: true,
  })
}

export function useDisconnectIntegration() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (integration: string) => disconnectIntegration(integration),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["connections"] })
      toast.success("Integration disconnected")
    },
    onError: (error) => {
      toast.error(`Failed to disconnect: ${error.message}`)
    },
  })
}
