import { useState, useCallback, useRef, useEffect, useMemo } from "react"
import { X, Save } from "lucide-react"
import { toast } from "sonner"
import { common, createLowlight } from "lowlight"
import { useNavigation } from "@/hooks/use-navigation"
import { setEditingCode, getEditingCode, artifactEditorKey } from "@/hooks/use-artifact-editor"
import { updateArtifactCode } from "@/api/client"
import { hastToHtml, escapeHtml } from "@/lib/hast-html"
import type { PanelState } from "@/types/navigation"

const lowlight = createLowlight(common)

function highlightCode(code: string): string {
  try {
    return hastToHtml(lowlight.highlight("jsx", code))
  } catch {
    return escapeHtml(code)
  }
}

// --- Component ---

interface CodeEditorPanelProps {
  panel: PanelState & { type: "code_editor" }
}

export function CodeEditorPanel({ panel }: CodeEditorPanelProps) {
  const { sessionId, sequence, initialCode, artifactPanelId } = panel.props
  const { removePanel, replacePanel, getPanels } = useNavigation()
  const key = artifactEditorKey(sessionId, sequence)
  const [code, setCode] = useState(initialCode)
  const [saving, setSaving] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const highlightRef = useRef<HTMLPreElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Initialize the editing store (only if not already editing)
  useEffect(() => {
    if (!getEditingCode(key)) setEditingCode(key, initialCode)
  }, [key, initialCode])

  // Sync scroll between textarea and highlight overlay
  useEffect(() => {
    const textarea = textareaRef.current
    const highlight = highlightRef.current
    if (!textarea || !highlight) return
    const syncScroll = () => {
      highlight.scrollTop = textarea.scrollTop
      highlight.scrollLeft = textarea.scrollLeft
    }
    textarea.addEventListener("scroll", syncScroll)
    return () => textarea.removeEventListener("scroll", syncScroll)
  }, [])

  const highlighted = useMemo(() => highlightCode(code), [code])

  const handleChange = useCallback(
    (value: string) => {
      setCode(value)
      // Debounced hot-reload
      clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        setEditingCode(key, value)
      }, 300)
    },
    [key],
  )

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await updateArtifactCode(sessionId, sequence, code)

      // Update the artifact panel's spec so the saved code persists after editor closes
      const panels = getPanels()
      const artifactPanel = panels.find((p) => p.id === artifactPanelId)
      if (artifactPanel && artifactPanel.type === "artifact") {
        const spec = { ...artifactPanel.props.spec } as any
        spec.data = typeof spec.data === "string" ? code : { ...spec.data, code }
        replacePanel(artifactPanelId, {
          ...artifactPanel,
          props: { ...artifactPanel.props, spec },
        } as typeof artifactPanel)
      }

      toast.success("Artifact saved")
    } catch (err) {
      toast.error("Failed to save artifact")
    } finally {
      setSaving(false)
    }
  }, [sessionId, sequence, code, artifactPanelId, getPanels, replacePanel])

  const handleClose = useCallback(() => {
    clearTimeout(debounceRef.current)
    // Keep edited code in store so artifacts retain the changes
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
      <div className="flex-1 min-h-0 mx-px mb-px relative overflow-hidden rounded-b-lg">
        {/* Syntax-highlighted underlay */}
        <pre
          ref={highlightRef}
          className="hljs absolute inset-0 overflow-hidden pointer-events-none m-0 p-4 pt-0 font-mono text-xs leading-[1.625] whitespace-pre-wrap break-words bg-transparent"
          aria-hidden
        >
          <code dangerouslySetInnerHTML={{ __html: highlighted + "\n" }} />
        </pre>
        {/* Transparent textarea on top for editing */}
        <textarea
          ref={textareaRef}
          value={code}
          onChange={(e) => handleChange(e.target.value)}
          className="absolute inset-0 w-full h-full resize-none bg-transparent font-mono text-xs leading-[1.625] p-4 pt-0 outline-none border-none text-transparent caret-foreground selection:bg-primary/30 whitespace-pre-wrap break-words"
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
        />
      </div>
    </div>
  )
}
