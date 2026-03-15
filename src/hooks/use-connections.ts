import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { getConnections, disconnectIntegration } from "@/api/client"

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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["connections"] })
    },
  })
}
