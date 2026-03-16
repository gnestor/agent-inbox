// src/components/navigation/PanelContent.tsx
import { lazy, Suspense } from "react"
import type { PanelState } from "@/types/navigation"
import { PanelSkeleton } from "@/components/shared/PanelSkeleton"

// Lazy-load tab-specific components to avoid circular imports
const SessionView = lazy(() =>
  import("@/components/session/SessionView").then((m) => ({ default: m.SessionView })),
)
const IntegrationsPage = lazy(() =>
  import("@/components/settings/IntegrationsPage").then((m) => ({ default: m.IntegrationsPage })),
)

interface PanelContentProps {
  panel: PanelState
}

export function PanelContent({ panel }: PanelContentProps) {
  const fallback = <PanelSkeleton />

  switch (panel.type) {
    case "session":
      return (
        <Suspense fallback={fallback}>
          <SessionView sessionId={panel.props.sessionId} />
        </Suspense>
      )

    case "settings":
      return (
        <Suspense fallback={fallback}>
          <IntegrationsPage />
        </Suspense>
      )

    // Placeholder for unmigrated panel types
    default:
      return (
        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
          <div className="text-center">
            <p className="font-medium">{panel.type}</p>
            <p className="text-xs mt-1">{panel.id}</p>
          </div>
        </div>
      )
  }
}
