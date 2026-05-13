import { useState, useCallback, useMemo } from "react"
import { X, Save } from "lucide-react"
import { toast } from "sonner"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigation } from "@/hooks/use-navigation"
import { setEditingCode, artifactEditorKey } from "@/hooks/use-artifact-editor"
import { getSession, updateArtifactCode } from "@/api/client"
import { findCodeByToolUseId } from "@/lib/session-pipeline"
import { MonacoEditor } from "@hammies/frontend/components/MonacoEditor"
import type { PanelState } from "@/types/navigation"

interface CodeEditorPanelProps {
  panel: PanelState & { type: "code_editor" }
}

export function CodeEditorPanel({ panel }: CodeEditorPanelProps) {
  const { sessionId, sequence, toolUseId, initialCode, artifactPanelId } = panel.props
  const { removePanel, replacePanel, getPanels } = useNavigation()
  const qc = useQueryClient()
  const key = artifactEditorKey(sessionId, sequence)
  const [userEdit, setUserEdit] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const { data: sessionData } = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => getSession(sessionId),
  })
  const freshCode = useMemo(
    () => findCodeByToolUseId(sessionData?.messages, toolUseId),
    [sessionData?.messages, toolUseId],
  )

  // Derived editor value: user's in-progress edits win, otherwise use the
  // latest JSONL code, otherwise the persisted panel prop (shown briefly
  // while the session query resolves on reload).
  const code = userEdit ?? freshCode ?? initialCode

  const handleChange = useCallback(
    (value: string) => {
      setUserEdit(value)
      setEditingCode(key, value)
    },
    [key],
  )

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await updateArtifactCode(sessionId, toolUseId, code)

      const panels = getPanels()
      const artifactPanel = panels.find((p) => p.id === artifactPanelId)
      if (artifactPanel && artifactPanel.type === "output") {
        const spec = { ...artifactPanel.props.spec }
        const specData = spec.data as string | { code: string; [key: string]: unknown }
        spec.data = typeof specData === "string" ? code : { ...specData, code }
        replacePanel(artifactPanelId, {
          ...artifactPanel,
          props: { ...artifactPanel.props, spec },
        } as typeof artifactPanel)
      }

      qc.invalidateQueries({ queryKey: ["session", sessionId] })

      toast.success("Artifact saved")
    } catch {
      toast.error("Failed to save artifact")
    } finally {
      setSaving(false)
    }
  }, [sessionId, sequence, toolUseId, code, artifactPanelId, getPanels, replacePanel, qc])

  const handleClose = useCallback(() => {
    removePanel(panel.id)
  }, [panel.id, removePanel])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="text-sm font-semibold">Edit Artifact</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground disabled:opacity-50"
            onClick={handleSave}
            disabled={saving}
            aria-label="Save"
            title="Save"
          >
            <Save className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground"
            onClick={handleClose}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <MonacoEditor
          value={code}
          onChange={handleChange}
          language="jsx"
          height="100%"
        />
      </div>
    </div>
  )
}
