// src/components/navigation/PanelContent.tsx
import { lazy, Suspense } from "react"
import type { PanelState } from "@/types/navigation"
import { PanelSkeleton } from "@/components/shared/PanelSkeleton"
import { OutputRenderer } from "@/components/session/OutputRenderer"
import { getArtifactSpec } from "@/lib/artifact-store"
import { useNavigation } from "@/hooks/use-navigation"

// Lazy-load tab-specific components to avoid circular imports
const SessionView = lazy(() =>
  import("@/components/session/SessionView").then((m) => ({ default: m.SessionView })),
)
const NewSessionPanel = lazy(() =>
  import("@/components/session/NewSessionPanel").then((m) => ({ default: m.NewSessionPanel })),
)
const IntegrationsPage = lazy(() =>
  import("@/components/settings/IntegrationsPage").then((m) => ({ default: m.IntegrationsPage })),
)

function ArtifactPanel({ panel }: { panel: PanelState & { type: "artifact" } }) {
  const { popPanel } = useNavigation()
  const spec = getArtifactSpec(panel.props.sessionId, panel.props.sequence)

  if (!spec) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        <p>Output not found</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="text-sm font-semibold">{spec.title || spec.type}</span>
        <button
          type="button"
          className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground"
          onClick={() => popPanel(panel.id)}
          aria-label="Close panel"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div className="flex-1 overflow-auto p-3">
        <OutputRenderer
          spec={{ ...spec, panel: false }}
          sessionId={panel.props.sessionId}
          sequence={panel.props.sequence}
        />
      </div>
    </div>
  )
}

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

    case "new_session":
      return (
        <Suspense fallback={fallback}>
          <NewSessionPanel />
        </Suspense>
      )

    case "settings":
      return (
        <Suspense fallback={fallback}>
          <IntegrationsPage />
        </Suspense>
      )

    case "artifact":
      return <ArtifactPanel panel={panel} />

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
