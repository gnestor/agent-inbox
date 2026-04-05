// src/components/navigation/PanelContent.tsx
import { lazy, Suspense, useState, useCallback, useMemo } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { X, Pencil } from "lucide-react"
import type { PanelState } from "@/types/navigation"
import { PanelSkeleton } from "@/components/shared/PanelSkeleton"
import { PanelHeader } from "@/components/shared/PanelHeader"
import { OutputRenderer, type OutputSpec } from "@/components/session/OutputRenderer"
import { AskUserOptions, parseAskUserAnswer } from "@/components/session/SessionTranscript"
import { AskUserForm } from "@/components/session/AskUserForm"
import { useAskUserForm } from "@/hooks/use-ask-user-form"
import { useNavActions } from "@/lib/navigation-store"
import { resumeSession, answerSessionQuestion } from "@/api/client"
import { useEditingCode, artifactEditorKey, setEditingCode } from "@/hooks/use-artifact-editor"
import { Skeleton } from "@hammies/frontend/components/ui"
import { createLogger } from "@/lib/logger"

const log = createLogger("panel")

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

function OutputPanel({ panel }: { panel: PanelState & { type: "output" } }) {
  const { removePanel, pushPanel } = useNavActions()
  const spec = panel.props.spec
  const { sessionId, sequence } = panel.props
  const editorKey = artifactEditorKey(sessionId, sequence)
  const editingCode = useEditingCode(editorKey)

  const handleAction = useCallback(
    (intent: string) => { resumeSession(sessionId, intent).catch((err) => log.error("Resume session failed", { sessionId, error: err instanceof Error ? err.message : String(err) })) },
    [sessionId],
  )

  // Override spec with editing code for hot-reload
  const activeSpec = useMemo((): OutputSpec | undefined => {
    if (!spec) return undefined
    if (editingCode == null || spec.type !== "react") return spec
    const data = typeof spec.data === "string" ? { code: editingCode } : { ...spec.data, code: editingCode }
    return { ...spec, data }
  }, [spec, editingCode])

  // For react artifacts, show panel skeleton until the iframe has rendered.
  const [artifactReady, setArtifactReady] = useState(spec?.type !== "react")
  const handleArtifactLoaded = useCallback(() => setArtifactReady(true), [])

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
    <div className="flex flex-col h-full relative">
      {!artifactReady && (
        <div className="absolute inset-0 z-10 flex flex-col bg-card">
          <PanelHeader
            left={<Skeleton className="h-4 w-32 rounded" />}
            right={<div className="w-8" />}
          />
          <PanelSkeleton />
        </div>
      )}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="text-sm font-semibold">{spec?.title || spec?.type || "Output"}</span>
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
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {activeSpec ? (
          <OutputRenderer
            spec={activeSpec}
            sessionId={sessionId}
            sequence={sequence}
            fillPanel
            onAction={handleAction}
            onArtifactLoaded={handleArtifactLoaded}
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

function AskUserQuestionPanel({ panel }: { panel: PanelState & { type: "ask_user" } }) {
  const { removePanel } = useNavActions()
  const qc = useQueryClient()
  const { questions, resultText, sessionId } = panel.props
  const isPending = !resultText && !!sessionId
  const selectedLabels = isPending ? [] : parseAskUserAnswer(resultText)
  const headerLabel = questions[0]?.header || "Question"
  const form = useAskUserForm(questions)

  const handleSubmit = useCallback(async () => {
    await form.handleSubmit(async (answers) => {
      await answerSessionQuestion(sessionId, answers)
      qc.invalidateQueries({ queryKey: ["sessions"] })
    })
    removePanel(panel.id)
  }, [form, sessionId, qc, removePanel, panel.id])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="text-sm font-semibold">{headerLabel}</span>
        <button
          type="button"
          className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground"
          onClick={() => removePanel(panel.id)}
          aria-label="Close panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
        {isPending ? (
          <AskUserForm questions={questions} form={form} onSubmit={handleSubmit} />
        ) : (
          <AskUserOptions questions={questions} selectedLabels={selectedLabels} />
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
          <SessionView sessionId={panel.props.sessionId} panelId={panel.id} />
        </Suspense>
      )

    case "new_session":
      return (
        <Suspense fallback={fallback}>
          <NewSessionPanel sourceType={panel.props.sourceType} sourceId={panel.props.sourceId} sourceContent={panel.props.sourceContent} />
        </Suspense>
      )

    case "settings":
      return (
        <Suspense fallback={fallback}>
          <IntegrationsPage />
        </Suspense>
      )

    case "output":
      return <OutputPanel panel={panel} />

    case "code_editor":
      return (
        <Suspense fallback={
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
              <span className="text-sm font-semibold">Edit Artifact</span>
            </div>
            <PanelSkeleton />
          </div>
        }>
          <CodeEditorPanel panel={panel} />
        </Suspense>
      )

    case "ask_user":
      return <AskUserQuestionPanel panel={panel} />

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
