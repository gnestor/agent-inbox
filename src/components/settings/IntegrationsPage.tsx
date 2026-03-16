import { useConnections } from "@/hooks/use-connections"
import { IntegrationCard } from "./IntegrationCard"
import { useSearchParams } from "react-router-dom"
import { useEffect } from "react"
import { PanelHeader, SidebarButton } from "@/components/shared/PanelHeader"
import { PanelSkeleton } from "@/components/shared/PanelSkeleton"

export function IntegrationsPage() {
  const { data: integrations, isLoading } = useConnections()
  const [searchParams, setSearchParams] = useSearchParams()

  const error = searchParams.get("error")
  const connected = searchParams.get("connected")

  // Clear URL params after showing status
  useEffect(() => {
    if (error || connected) {
      const timeout = setTimeout(() => {
        setSearchParams({})
      }, 5000)
      return () => clearTimeout(timeout)
    }
  }, [error, connected, setSearchParams])

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
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              Connection failed: {error}
            </div>
          )}

          {connected && (
            <div className="rounded-md border border-green-500/50 bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-400">
              Successfully connected {integrations?.find((i) => i.id === connected)?.name || connected}!
            </div>
          )}

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
