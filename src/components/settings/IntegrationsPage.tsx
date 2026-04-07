import { useEffect, useRef } from "react"
import { useConnections } from "@/hooks/use-connections"
import { IntegrationCard } from "./IntegrationCard"
import { useSearchParams } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { PanelHeader, SidebarButton } from "@/components/shared/PanelHeader"
import { PanelSkeleton } from "@/components/shared/PanelSkeleton"
import { useUser } from "@/hooks/use-user"
import { toast } from "sonner"

const OAUTH_CHANNEL = "oauth-connection"

export function IntegrationsPage() {
  const { user } = useUser()
  const { data: integrations, isLoading } = useConnections()
  const [searchParams, setSearchParams] = useSearchParams()
  const qc = useQueryClient()
  const handledRef = useRef(false)

  // Handle OAuth callback result (runs in the popup window after redirect)
  useEffect(() => {
    const error = searchParams.get("error")
    const connected = searchParams.get("connected")
    if (!error && !connected) return
    if (connected && !integrations) return
    if (handledRef.current) return
    handledRef.current = true

    if (error) {
      toast.error(`Connection failed: ${error}`)
    } else if (connected) {
      const name = integrations?.find((i) => i.id === connected)?.name ?? connected
      toast.success(`Successfully connected ${name}!`)
      // Notify the original tab to refetch connections
      try {
        const bc = new BroadcastChannel(OAUTH_CHANNEL)
        bc.postMessage({ type: "connected", integration: connected })
        bc.close()
      } catch {}
    }
    setSearchParams({})
  }, [searchParams, integrations, setSearchParams])

  // Listen for OAuth completion from popup windows and refetch
  useEffect(() => {
    try {
      const bc = new BroadcastChannel(OAUTH_CHANNEL)
      bc.onmessage = () => {
        qc.invalidateQueries({ queryKey: ["connections"] })
      }
      return () => bc.close()
    } catch {
      return undefined
    }
  }, [qc])

  const userIntegrations = integrations?.filter((i) => i.scope === "user") || []

  return (
    <div className="flex flex-col h-full w-full">
      <PanelHeader
        left={
          <>
            <SidebarButton />
            <h2 className="font-semibold text-sm">{user?.name || "Settings"}</h2>
          </>
        }
      />

      {isLoading ? (
        <PanelSkeleton />
      ) : (
        <div className="flex-1 overflow-y-auto p-4 space-y-6 max-w-2xl">
          {userIntegrations.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold">Integrations</h2>
              <p className="text-xs text-muted-foreground">
                Connect your personal accounts. Only you can access these credentials.
              </p>
              <div className="space-y-2">
                {userIntegrations.map((integration) => (
                  <IntegrationCard key={integration.id} integration={integration} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
