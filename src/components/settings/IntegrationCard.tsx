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
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted text-lg">
          {integrationEmoji(integration.id)}
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
          <p className={`text-xs ${integration.connected ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
            {integration.connected ? "Connected" : "Not configured"}
          </p>
        </div>
      </div>
      <div>
        {!isWorkspace && integration.connected && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleDisconnect}
            disabled={disconnect.isPending}
          >
            Disconnect
          </Button>
        )}
        {!isWorkspace && !integration.connected && (
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
    google: "📧",
    pinterest: "📌",
    quickbooks: "📒",
    notion: "📝",
    slack: "💬",
    github: "🐙",
    shopify: "🛍️",
    air: "🖼️",
    gorgias: "🎧",
    meta: "📢",
    facebook: "👤",
    instagram: "📸",
    klaviyo: "📩",
    "google-ads": "📊",
    shippo: "📦",
    "happy-returns": "↩️",
    observable: "📈",
  }
  return map[id] || "🔗"
}
