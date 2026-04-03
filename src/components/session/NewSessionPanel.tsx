import { useEffect, useRef, useState, lazy, Suspense } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Button, Input } from "@hammies/frontend/components/ui"

const RichTextEditor = lazy(() =>
  import("@/components/shared/RichTextEditor").then((m) => ({ default: m.RichTextEditor })),
)
import { BookmarkPlus, X, Loader2, Trash2 } from "lucide-react"
import { useIsMobile } from "@hammies/frontend/hooks"
import { PanelHeader, BackButton } from "@/components/shared/PanelHeader"
import { useNavActions } from "@/lib/navigation-store"
import { createSession, getPluginItem } from "@/api/client"
import { getItemTitle } from "@/lib/formatters"
import { useWorkspaceId } from "@/hooks/use-user"
import { useLocalDraft } from "@/hooks/use-local-draft"
import { usePreference } from "@/hooks/use-preferences"
import { useFileAttachments } from "@/hooks/use-file-attachments"
import { uploadPendingFiles } from "@/hooks/use-session-view"
import { FileAttachmentBar, AttachButton, DragOverlay } from "./FileAttachmentBar"
import { SessionView } from "./SessionView"
import { NEW_SESSION_PANEL } from "@/types/navigation"
import type { PluginItem } from "@/types/plugin"
import { createLogger } from "@/lib/logger"

const log = createLogger("new-session")


interface PromptTemplate {
  name: string
  content: string
}

interface NewSessionPanelProps {
  panelId?: string
  sessionId?: string
  autoStart?: boolean
  sourceType?: string
  sourceId?: string
  sourceContent?: string
}

/** Fetch a plugin item generically — works for any source type */
function useSourceItem(sourceType?: string, sourceId?: string) {
  const wsId = useWorkspaceId()
  return useQuery<PluginItem>({
    queryKey: ["plugin-item", wsId, sourceType, sourceId],
    queryFn: () => getPluginItem(sourceType!, sourceId!),
    enabled: !!sourceType && !!sourceId,
  })
}

// ── Active session (delegates to SessionView) ────────────────────────────────

export function NewSessionPanel({ panelId, sessionId, autoStart, sourceType, sourceId, sourceContent }: NewSessionPanelProps) {
  if (sessionId) {
    return <SessionView sessionId={sessionId} panelId={`session:${sessionId}`} />
  }

  if (autoStart && sourceId) {
    return <AutoStartPanel sourceType={sourceType} sourceId={sourceId} />
  }
  return <ComposePanel panelId={panelId} sourceType={sourceType} sourceId={sourceId} sourceContent={sourceContent} />
}

// ── Auto-start panel (fires createSession immediately, no compose UI) ─────────

function AutoStartPanel({ sourceType, sourceId }: { sourceType?: string; sourceId?: string }) {
  const { openSession } = useNavActions()
  const qc = useQueryClient()
  const fired = useRef(false)

  const { data: item } = useSourceItem(sourceType, sourceId)

  const createMutation = useMutation({
    mutationFn: (prompt: string) =>
      createSession({
        prompt,
        linkedSourceType: sourceType,
        linkedSourceId: sourceId,
        linkedItemTitle: item ? getItemTitle(item as Record<string, unknown>) || undefined : undefined,
      }),
    onSuccess: ({ sessionId }) => {
      qc.invalidateQueries({ queryKey: ["sessions"] })
      openSession(sessionId)
    },
  })

  useEffect(() => {
    if (fired.current || !item) return
    fired.current = true
    createMutation.mutate(`Process this ${sourceType}`)
  }, [item])

  return (
    <div className="flex flex-col h-full items-center justify-center gap-3 text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin" />
      <p className="text-sm">Starting session…</p>
    </div>
  )
}

// ── Compose panel ────────────────────────────────────────────────────────────

function ComposePanel({ panelId, sourceType, sourceId, sourceContent }: { panelId?: string; sourceType?: string; sourceId?: string; sourceContent?: string }) {
  const { popPanel, replacePanel } = useNavActions()
  const qc = useQueryClient()
  const isMobile = useIsMobile()
  const [savingName, setSavingName] = useState("")
  const [showSaveInput, setShowSaveInput] = useState(false)
  const [templates, setTemplates] = usePreference<PromptTemplate[]>("session_prompt_templates", [])

  const draftKey = sourceId ? `inbox:draft:${sourceType}:${sourceId}` : ""

  const [prompt, setPrompt] = useLocalDraft(draftKey)
  const hasSavedDraft = useRef(!!prompt)

  // File attachments
  const attachments = useFileAttachments()

  // Fetch linked data — reuses cache if already loaded
  const { data: item } = useSourceItem(sourceType, sourceId)

  // Derived — no useState needed
  const ready = hasSavedDraft.current || !sourceId || !!item

  // Seed prompt once when linked data first arrives (render-time, no effect needed)
  const seeded = useRef(hasSavedDraft.current)
  if (!seeded.current && item) {
    seeded.current = true
    setPrompt(`Process this ${sourceType}`)
  }

  const itemTitle = getItemTitle(item as Record<string, unknown>) || undefined

  const createMutation = useMutation({
    mutationFn: async () => {
      // Create session first, then upload files and append references
      const { sessionId } = await createSession({
        prompt,
        linkedSourceType: sourceType,
        linkedSourceId: sourceId,
        linkedSourceContent: sourceContent,
        linkedItemTitle: itemTitle,
      })

      // Upload files after session creation (need sessionId)
      if (attachments.hasFiles) {
        const uploaded = await uploadPendingFiles(sessionId, attachments.files)
        if (uploaded.length > 0) {
          const refs = uploaded.map((f) => `[Attached: ${f.name} at ${f.path}]`).join("\n")
          // Resume session with file references so the agent knows about them
          const { resumeSession } = await import("@/api/client")
          await resumeSession(sessionId, `Files attached:\n${refs}`)
        }
        attachments.clearAll()
      }

      return { sessionId }
    },
    onSuccess: ({ sessionId }) => {
      setPrompt("")
      qc.invalidateQueries({ queryKey: ["sessions"] })
      qc.invalidateQueries({ queryKey: ["linked-session"] })
      replacePanel(panelId ?? NEW_SESSION_PANEL.id, {
        id: `session:${sessionId}`,
        type: "session",
        props: { sessionId },
      })
    },
    onError: (err: unknown) => log.error("Failed to start session", { error: err instanceof Error ? err.message : String(err) }),
  })

  function handleClose() {
    popPanel(panelId ?? NEW_SESSION_PANEL.id)
  }

  function handleSaveTemplate() {
    const name = savingName.trim()
    if (!name) return
    setTemplates([...templates, { name, content: prompt }])
    setSavingName("")
    setShowSaveInput(false)
  }

  const sending = createMutation.isPending

  return (
    <div className="flex flex-col h-full relative" {...attachments.dragHandlers}>
      <DragOverlay visible={attachments.isDragOver} />

      <PanelHeader
        left={
          <>
            {isMobile && <BackButton onClick={handleClose} />}
            <h2 className="font-semibold text-sm">New Session</h2>
          </>
        }
        right={
          !isMobile ? (
            <button
              type="button"
              className="shrink-0 p-1.5 rounded-md hover:bg-secondary text-muted-foreground"
              onClick={handleClose}
            >
              <X className="h-4 w-4" />
            </button>
          ) : undefined
        }
      />

      {/* Body */}
      <div className="flex-1 min-h-0 flex flex-col gap-4 p-4 overflow-y-auto" onPaste={attachments.handlePaste}>
        {/* Saved templates */}
        {templates.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
              Templates
            </p>
            <div className="flex flex-col gap-0.5">
              {templates.map((t, i) => (
                <div key={i} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPrompt(t.content)}
                    className="flex-1 text-left text-sm px-2 py-1.5 rounded-md hover:bg-secondary truncate"
                  >
                    {t.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTemplates(templates.filter((_, j) => j !== i))}
                    className="shrink-0 p-1.5 rounded-md hover:bg-secondary text-muted-foreground"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Attachment bar */}
        {(attachments.hasFiles || attachments.error) && (
          <FileAttachmentBar
            files={attachments.files}
            error={attachments.error}
            onRemove={attachments.removeFile}
            onClearError={attachments.clearError}

            fileInputRef={attachments.fileInputRef}
            onFileInputChange={attachments.handleFileInputChange}
          />
        )}

        {/* Prompt editor */}
        <Suspense fallback={<div className="flex-1 min-h-[200px]" />}>
          <RichTextEditor
            value={ready ? prompt : ""}
            onChange={setPrompt}
            onCmdEnter={() => createMutation.mutate()}
            placeholder={ready ? "Write a prompt..." : "Loading..."}
            disabled={!ready}
            className="flex-1 min-h-[200px]"
          />
        </Suspense>

        {/* Save as template */}
        {showSaveInput ? (
          <div className="flex gap-2">
            <Input
              value={savingName}
              onChange={(e) => setSavingName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSaveTemplate()}
              placeholder="Template name"
              className="flex-1"
              autoFocus
            />
            <Button
              variant="outline"
              size="sm"
              onClick={handleSaveTemplate}
              disabled={!savingName.trim()}
            >
              Save
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowSaveInput(false)
                setSavingName("")
              }}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <AttachButton onClick={attachments.openFilePicker} />
            <button
              type="button"
              onClick={() => setShowSaveInput(true)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <BookmarkPlus className="h-3.5 w-3.5" />
              Save as template
            </button>
          </div>
        )}
      </div>

      {/* Hidden file input */}
      {!attachments.hasFiles && !attachments.error && (
        <input
          ref={attachments.fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={attachments.handleFileInputChange}
        />
      )}

      {/* Footer */}
      <div className="shrink-0 border-t p-4">
        <Button
          onClick={() => createMutation.mutate()}
          disabled={!prompt.trim() || !ready || sending}
          className="w-full"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Start Session"}
        </Button>
      </div>
    </div>
  )
}
