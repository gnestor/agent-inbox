import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Button, Input } from "@hammies/frontend/components/ui"
import { RichTextEditor } from "@/components/shared/RichTextEditor"
import { BookmarkPlus, X, Loader2, Trash2 } from "lucide-react"
import { useIsMobile } from "@hammies/frontend/hooks"
import { PanelHeader, BackButton } from "@/components/shared/PanelHeader"
import { createSession, getTask } from "@/api/client"
import { useEmailThread } from "@/hooks/use-email-thread"
import { usePreference } from "@/hooks/use-preferences"
import { SessionView } from "./SessionView"
import type { NotionTaskDetail } from "@/types"


interface PromptTemplate {
  name: string
  content: string
}

interface NewSessionPanelProps {
  threadId?: string
  taskId?: string
  sessionId?: string
  autoStart?: boolean
}

// ── Active session (delegates to SessionView) ────────────────────────────────

export function NewSessionPanel({ threadId, taskId, sessionId, autoStart }: NewSessionPanelProps) {
  if (sessionId) {
    return <SessionView sessionId={sessionId} />
  }
  if (autoStart && (threadId || taskId)) {
    return <AutoStartPanel threadId={threadId} taskId={taskId} />
  }
  return <ComposePanel threadId={threadId} taskId={taskId} />
}

// ── Auto-start panel (fires createSession immediately, no compose UI) ─────────

function AutoStartPanel({ threadId, taskId }: { threadId?: string; taskId?: string }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const fired = useRef(false)

  const { thread } = useEmailThread(threadId)
  const { data: task } = useQuery<NotionTaskDetail>({
    queryKey: ["task", taskId],
    queryFn: () => getTask(taskId!),
    enabled: !!taskId,
  })

  const createMutation = useMutation({
    mutationFn: (prompt: string) =>
      createSession({
        prompt,
        linkedEmailThreadId: thread?.id,
        linkedEmailId: thread?.messages[0]?.id,
        linkedTaskId: task?.id,
      }),
    onSuccess: ({ sessionId }) => {
      qc.invalidateQueries({ queryKey: ["sessions"] })
      if (threadId) navigate(`/emails/${threadId}/session/${sessionId}`)
      else if (taskId) navigate(`/tasks/${taskId}/session/${sessionId}`)
    },
  })

  useEffect(() => {
    if (fired.current) return
    if (threadId && thread) {
      fired.current = true
      const prompt = `<ide_opened_file>Email thread: ${thread.id} (message: ${thread.messages[0]?.id ?? ""})</ide_opened_file>\nProcess this email`
      createMutation.mutate(prompt)
    } else if (taskId && task) {
      fired.current = true
      const prompt = `<ide_opened_file>Notion task: ${task.id}</ide_opened_file>\nProcess this task`
      createMutation.mutate(prompt)
    }
  }, [thread, task])

  return (
    <div className="flex flex-col h-full items-center justify-center gap-3 text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin" />
      <p className="text-sm">Starting session…</p>
    </div>
  )
}

// ── Compose panel ────────────────────────────────────────────────────────────

function ComposePanel({ threadId, taskId }: { threadId?: string; taskId?: string }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isMobile = useIsMobile()
  const [savingName, setSavingName] = useState("")
  const [showSaveInput, setShowSaveInput] = useState(false)
  const [templates, setTemplates] = usePreference<PromptTemplate[]>("session_prompt_templates", [])

  const draftKey = threadId
    ? `inbox:draft:thread:${threadId}`
    : taskId
      ? `inbox:draft:task:${taskId}`
      : null

  // Read once at mount — null means no key, "" means cleared, non-empty means real draft
  const savedDraft = useState(() => {
    if (!draftKey) return null
    try { return localStorage.getItem(draftKey) } catch { return null }
  })[0]

  const [prompt, setPrompt] = useState(savedDraft ?? "")

  // If there's a saved draft, skip the "Loading..." state — show it immediately
  const hasSavedDraft = useRef(!!savedDraft)
  const [ready, setReady] = useState(!!savedDraft)

  // Persist draft on every change
  useEffect(() => {
    if (!draftKey) return
    try { localStorage.setItem(draftKey, prompt) } catch {}
  }, [draftKey, prompt])

  // Fetch linked data — reuses cache from EmailThread / TaskDetail if already loaded
  const { thread } = useEmailThread(threadId)
  const { data: task } = useQuery<NotionTaskDetail>({
    queryKey: ["task", taskId],
    queryFn: () => getTask(taskId!),
    enabled: !!taskId,
  })

  useEffect(() => {
    if (threadId && thread) {
      if (!hasSavedDraft.current) setPrompt("Process this email")
      setReady(true)
    }
  }, [thread, threadId])

  useEffect(() => {
    if (taskId && task) {
      if (!hasSavedDraft.current) setPrompt("Process this task")
      setReady(true)
    }
  }, [task, taskId])

  const contextPrefix = thread
    ? `<ide_opened_file>Email thread: ${thread.id} (message: ${thread.messages[0]?.id ?? ""})</ide_opened_file>`
    : task
      ? `<ide_opened_file>Notion task: ${task.id}</ide_opened_file>`
      : ""
  const fullPrompt = contextPrefix ? `${contextPrefix}\n${prompt}` : prompt

  const createMutation = useMutation({
    mutationFn: () =>
      createSession({
        prompt: fullPrompt,
        linkedEmailThreadId: thread?.id,
        linkedEmailId: thread?.messages[0]?.id,
        linkedTaskId: task?.id,
      }),
    onSuccess: ({ sessionId }) => {
      if (draftKey) try { localStorage.removeItem(draftKey) } catch {}
      qc.invalidateQueries({ queryKey: ["sessions"] })
      qc.invalidateQueries({ queryKey: ["linked-session"] })
      if (threadId) navigate(`/emails/${threadId}/session/${sessionId}`)
      else if (taskId) navigate(`/tasks/${taskId}/session/${sessionId}`)
    },
    onError: (err: any) => console.error("Failed to start session:", err),
  })

  function parentPath() {
    if (threadId) return `/emails/${threadId}`
    if (taskId) return `/tasks/${taskId}`
    return "/"
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
    <div className="flex flex-col h-full">
      <PanelHeader
        left={
          <>
            {isMobile && <BackButton onClick={() => navigate(parentPath())} />}
            <h2 className="font-semibold text-sm">New Session</h2>
          </>
        }
        right={
          !isMobile ? (
            <button
              type="button"
              className="shrink-0 p-1.5 rounded-md hover:bg-accent text-muted-foreground"
              onClick={() => navigate(parentPath())}
            >
              <X className="h-4 w-4" />
            </button>
          ) : undefined
        }
      />

      {/* Body */}
      <div className="flex-1 flex flex-col gap-4 p-4 overflow-y-auto">
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
                    className="flex-1 text-left text-sm px-2 py-1.5 rounded-md hover:bg-accent truncate"
                  >
                    {t.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTemplates(templates.filter((_, j) => j !== i))}
                    className="shrink-0 p-1.5 rounded-md hover:bg-accent text-muted-foreground"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Prompt editor */}
        <RichTextEditor
          value={ready ? prompt : ""}
          onChange={setPrompt}
          onCmdEnter={() => createMutation.mutate()}
          placeholder={ready ? "Describe what you want the agent to do..." : "Loading..."}
          disabled={!ready}
          className="flex-1 min-h-[200px]"
        />

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
          <button
            type="button"
            onClick={() => setShowSaveInput(true)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors self-start"
          >
            <BookmarkPlus className="h-3.5 w-3.5" />
            Save as template
          </button>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t p-4">
        <Button
          onClick={() => createMutation.mutate()}
          disabled={!fullPrompt.trim() || !ready || sending}
          className="w-full"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Start Session"}
        </Button>
      </div>
    </div>
  )
}
