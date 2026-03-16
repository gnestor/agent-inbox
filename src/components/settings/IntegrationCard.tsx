import { Button, Badge } from "@hammies/frontend/components/ui"
import { getConnectUrl } from "@/api/client"
import { useDisconnectIntegration } from "@/hooks/use-connections"
import { IntegrationIcon } from "./IntegrationIcon"
import type { Integration } from "@/types"

interface IntegrationCardProps {
  integration: Integration
}

export function IntegrationCard({ integration }: IntegrationCardProps) {
  const disconnect = useDisconnectIntegration()

  function handleConnect() {
    const url = getConnectUrl(integration.id) + `?origin=${encodeURIComponent(window.location.origin)}`
    window.open(url, "_blank", "noopener")
  }

  function handleDisconnect() {
    if (confirm(`Disconnect ${integration.name}?`)) {
      disconnect.mutate(integration.id)
    }
  }

  const isWorkspace = integration.scope === "workspace"

  return (
    <div className="flex items-center justify-between rounded-lg border p-3">
      <div className="flex items-center gap-3">
        <IntegrationIcon
          integrationId={integration.id}
          className="flex h-8 w-8 items-center justify-center rounded-md bg-muted"
        />
        <div>
          <span className="text-sm font-medium">{integration.name}</span>
          <p className={`text-xs ${integration.connected ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
            {integration.connected ? "Connected" : "Not configured"}
          </p>
        </div>
      </div>
      <div>
        {isWorkspace ? (
          <Badge variant="secondary" className="text-xs">
            Managed by admin
          </Badge>
        ) : integration.connected ? (
          <Button
            variant="outline"
            size="sm"
            onClick={handleDisconnect}
            disabled={disconnect.isPending}
          >
            Disconnect
          </Button>
        ) : (
          <Button size="sm" onClick={handleConnect}>
            Connect
          </Button>
        )}
      </div>
    </div>
  )
}