// src/components/navigation/PanelContent.tsx
import { lazy, Suspense, useCallback, useMemo } from "react"
import { X, Pencil } from "lucide-react"
import type { PanelState } from "@/types/navigation"
import { PanelSkeleton } from "@/components/shared/PanelSkeleton"
import { OutputRenderer, type OutputSpec } from "@/components/session/OutputRenderer"
import { useNavigation } from "@/hooks/use-navigation"
import { resumeSession } from "@/api/client"
import { useEditingCode, artifactEditorKey, setEditingCode } from "@/hooks/use-artifact-editor"

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
const CodeEditorPanel = lazy(() =>
  import("@/components/session/CodeEditorPanel").then((m) => ({ default: m.CodeEditorPanel })),
)

function ArtifactPanel({ panel }: { panel: PanelState & { type: "artifact" } }) {
  const { removePanel, pushPanel } = useNavigation()
  const spec = panel.props.spec
  const { sessionId, sequence } = panel.props
  const editorKey = artifactEditorKey(sessionId, sequence)
  const editingCode = useEditingCode(editorKey)

  const handleAction = useCallback(
    (intent: string) => { resumeSession(sessionId, intent).catch(console.error) },
    [sessionId],
  )

  // Override spec with editing code for hot-reload
  const activeSpec = useMemo((): OutputSpec | undefined => {
    if (!spec) return undefined
    if (editingCode == null || spec.type !== "react") return spec
    const data = typeof spec.data === "string" ? { code: editingCode } : { ...spec.data, code: editingCode }
    return { ...spec, data }
  }, [spec, editingCode])

  const handleEdit = useCallback(() => {
    if (!spec || spec.type !== "react") return
    const code = typeof spec.data === "string" ? spec.data : spec.data?.code || ""
    setEditingCode(editorKey, code)
    pushPanel({
      id: `editor:${sessionId}:${sequence}`,
      type: "code_editor",
      props: { sessionId, sequence, initialCode: code, artifactPanelId: panel.id },
    })
  }, [spec, editorKey, sessionId, sequence, pushPanel, panel.id])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="text-sm font-semibold">{spec?.title || spec?.type || "Artifact"}</span>
        <div className="flex items-center gap-0.5">
          {spec?.type === "react" && (
            <button
              type="button"
              className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground"
              onClick={handleEdit}
              aria-label="Edit artifact"
              title="Edit code"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground"
            onClick={() => removePanel(panel.id)}
            aria-label="Close panel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeSpec ? (
          <OutputRenderer
            spec={activeSpec}
            sessionId={sessionId}
            sequence={sequence}
            fillPanel
            onAction={handleAction}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            <p>Output not found</p>
          </div>
        )}
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

    case "code_editor":
      return (
        <Suspense fallback={fallback}>
          <CodeEditorPanel panel={panel} />
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
