import { useConnections } from "@/hooks/use-connections"
import { IntegrationCard } from "./IntegrationCard"
import { useSearchParams } from "react-router-dom"
import { useEffect } from "react"

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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="text-muted-foreground">Loading integrations...</span>
      </div>
    )
  }

  const userIntegrations = integrations?.filter((i) => i.scope === "user") || []
  const workspaceIntegrations = integrations?.filter((i) => i.scope === "workspace") || []

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-6 overflow-y-auto h-full">
      <div>
        <h1 className="text-2xl font-bold">Integrations</h1>
        <p className="text-muted-foreground mt-1">
          Connect your accounts to let the AI agent access your tools.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          Connection failed: {error}
        </div>
      )}

      {connected && (
        <div className="rounded-md border border-green-500/50 bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-400">
          Successfully connected {connected}!
        </div>
      )}

      {userIntegrations.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">User</h2>
          <p className="text-sm text-muted-foreground">
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
          <h2 className="text-lg font-semibold">Workspace</h2>
          <p className="text-sm text-muted-foreground">
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
  )
}
