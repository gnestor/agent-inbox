import { useEffect } from "react"
import { useConnections } from "@/hooks/use-connections"
import { IntegrationCard } from "./IntegrationCard"
import { useSearchParams } from "react-router-dom"
import { PanelHeader, SidebarButton } from "@/components/shared/PanelHeader"
import { PanelSkeleton } from "@/components/shared/PanelSkeleton"
import { toast } from "sonner"

export function IntegrationsPage() {
  const { data: integrations, isLoading } = useConnections()
  const [searchParams, setSearchParams] = useSearchParams()

  useEffect(() => {
    const error = searchParams.get("error")
    const connected = searchParams.get("connected")
    if (!error && !connected) return
    if (connected && !integrations) return
    if (error) {
      toast.error(`Connection failed: ${error}`)
    } else if (connected) {
      const name = integrations?.find((i) => i.id === connected)?.name ?? connected
      toast.success(`Successfully connected ${name}!`)
    }
    setSearchParams({})
  }, [searchParams, integrations, setSearchParams])

  const userIntegrations = integrations?.filter((i) => i.scope === "user") || []
  const workspaceIntegrations = integrations?.filter((i) => i.scope === "workspace") || []

  return (
    <div className="flex flex-col h-full w-full">
      <PanelHeader
        left={
          <>
            <SidebarButton />
            <h2 className="font-semibold text-sm">Integrations</h2>
          </>
        }
      />

      {isLoading ? (
        <PanelSkeleton />
      ) : (
        <div className="flex-1 overflow-y-auto p-4 space-y-6 max-w-2xl">

          {userIntegrations.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold">User</h2>
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

          {workspaceIntegrations.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold">Workspace</h2>
              <p className="text-xs text-muted-foreground">
                Shared service accounts managed by the workspace admin via CLI.
              </p>
              <div className="space-y-2">
                {workspaceIntegrations.map((integration) => (
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
