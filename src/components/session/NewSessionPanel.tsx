import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Button, Input } from "@hammies/frontend/components/ui"
import { RichTextEditor } from "@/components/shared/RichTextEditor"
import { BookmarkPlus, X, Loader2, Trash2 } from "lucide-react"
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
}

// ── Active session (delegates to SessionView) ────────────────────────────────

export function NewSessionPanel({ threadId, taskId, sessionId }: NewSessionPanelProps) {
  if (sessionId) {
    return <SessionView sessionId={sessionId} />
  }
  return <ComposePanel threadId={threadId} taskId={taskId} />
}

// ── Compose panel ────────────────────────────────────────────────────────────

function ComposePanel({ threadId, taskId }: { threadId?: string; taskId?: string }) {
  const navigate = useNavigate()
  const [prompt, setPrompt] = useState("")
  const [ready, setReady] = useState(false)
  const [sending, setSending] = useState(false)
  const [savingName, setSavingName] = useState("")
  const [showSaveInput, setShowSaveInput] = useState(false)
  const [templates, setTemplates] = usePreference<PromptTemplate[]>(
    "session_prompt_templates",
    [],
  )

  // Fetch linked data and build initial prompt
  const { thread } = useEmailThread(threadId)
  const [task, setTask] = useState<NotionTaskDetail | null>(null)

  useEffect(() => {
    if (taskId) {
      getTask(taskId)
        .then(setTask)
        .catch(() => {})
    }
  }, [taskId])

  useEffect(() => {
    if (threadId && thread) {
      setPrompt(`Process this email: "${thread.subject}"`)
      setReady(true)
    }
  }, [thread, threadId])

  useEffect(() => {
    if (taskId && task) {
      setPrompt(
        `Work on this task:\n\nTitle: ${task.title}\nStatus: ${task.status}\nPriority: ${task.priority}\nTags: ${task.tags.join(", ")}\n\n${task.body}`,
      )
      setReady(true)
    }
  }, [task, taskId])

  function parentPath() {
    if (threadId) return `/inbox/${threadId}`
    if (taskId) return `/tasks/${taskId}`
    return "/"
  }

  async function handleStart() {
    if (!prompt.trim() || sending) return
    setSending(true)
    try {
      const { sessionId } = await createSession({
        prompt,
        linkedEmailThreadId: thread?.id,
        linkedEmailId: thread?.messages[0]?.id,
        linkedTaskId: task?.id,
      })
      // Navigate to the session URL — the same column instance stays mounted
      if (threadId) navigate(`/inbox/${threadId}/session/${sessionId}`)
      else if (taskId) navigate(`/tasks/${taskId}/session/${sessionId}`)
    } catch (err: any) {
      console.error("Failed to start session:", err)
    } finally {
      setSending(false)
    }
  }

  function handleSaveTemplate() {
    const name = savingName.trim()
    if (!name) return
    setTemplates([...templates, { name, content: prompt }])
    setSavingName("")
    setShowSaveInput(false)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex h-12 items-center justify-between px-4 border-b shrink-0">
        <h2 className="font-semibold text-sm">New Session</h2>
        <button
          type="button"
          className="shrink-0 p-1.5 rounded-md hover:bg-accent text-muted-foreground"
          onClick={() => navigate(parentPath())}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 flex flex-col gap-4 p-4 overflow-y-auto">
        {/* Saved templates */}
        {templates.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Templates</p>
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
          onCmdEnter={handleStart}
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
            <Button variant="outline" size="sm" onClick={handleSaveTemplate} disabled={!savingName.trim()}>
              Save
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setShowSaveInput(false); setSavingName("") }}>
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
        <Button onClick={handleStart} disabled={!prompt.trim() || !ready || sending} className="w-full">
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Start Session"}
        </Button>
      </div>
    </div>
  )
}
