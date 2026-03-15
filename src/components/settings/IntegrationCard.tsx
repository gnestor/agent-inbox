import { Button, Badge } from "@hammies/frontend/components/ui"
import { getConnectUrl } from "@/api/client"
import { useDisconnectIntegration } from "@/hooks/use-connections"
import type { Integration } from "@/types"

interface IntegrationCardProps {
  integration: Integration
}

export function IntegrationCard({ integration }: IntegrationCardProps) {
  const disconnect = useDisconnectIntegration()

  function handleConnect() {
    // Pass the browser origin so the server builds the correct redirect_uri
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
    <div className="flex items-center justify-between rounded-lg border p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
          <span className="text-lg">{integrationEmoji(integration.id)}</span>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium">{integration.name}</span>
            {isWorkspace && (
              <Badge variant="secondary" className="text-xs">
                Managed by admin
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {integration.connected ? "Connected" : "Not connected"}
          </p>
        </div>
      </div>
      <div>
        {integration.connected ? (
          isWorkspace ? (
            <Badge variant="outline" className="text-green-600">
              Active
            </Badge>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={handleDisconnect}
              disabled={disconnect.isPending}
            >
              Disconnect
            </Button>
          )
        ) : isWorkspace ? (
          <Badge variant="outline" className="text-muted-foreground">
            Not configured
          </Badge>
        ) : (
          <Button size="sm" onClick={handleConnect}>
            Connect
          </Button>
        )}
      </div>
    </div>
  )
}

function integrationEmoji(id: string): string {
  const map: Record<string, string> = {
    notion: "📝",
    slack: "💬",
    github: "🐙",
    shopify: "🛍️",
    air: "🖼️",
    google: "📧",
  }
  return map[id] || "🔗"
}
