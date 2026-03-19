import { useState, useEffect, useRef } from "react"
import { useLocation } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Button,
  Textarea,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuCheckboxItem,
} from "@hammies/frontend/components/ui"
import { Send, Square, Loader2, X, Ellipsis, Archive } from "lucide-react"
import { getSession, resumeSession, abortSession, answerSessionQuestion, updateSession, archiveSession } from "@/api/client"
import type { SessionStatus } from "@/types"
import { useSessionStream } from "@/hooks/use-session-stream"
import { useNavigation } from "@/hooks/use-navigation"
import { SessionTranscript, DEFAULT_TRANSCRIPT_VISIBILITY } from "./SessionTranscript"
import type { TranscriptVisibility } from "./SessionTranscript"
import { AskUserPanel } from "./AskUserPanel"
import { PanelHeader, BackButton, SidebarButton } from "@/components/shared/PanelHeader"
import { PanelSkeleton } from "@/components/shared/PanelSkeleton"
import { usePreference } from "@/hooks/use-preferences"

interface SessionViewProps {
  sessionId: string
  title?: string
}

export function SessionView({ sessionId, title }: SessionViewProps) {
  const location = useLocation()
  const qc = useQueryClient()
  const { activeTab, popPanel, deselectItem } = useNavigation()
  // Recent-route sessions are sidebar-originated — show SidebarButton, no X, use linkedItemTitle
  const isFromSidebar = location.pathname.startsWith("/recent/")
  const sessionPanelId = `session:${sessionId}`

  function handleBack() {
    if (activeTab === "sessions") {
      deselectItem()
    } else {
      popPanel(sessionPanelId)
    }
  }
  const { data, isLoading, error: queryError } = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => getSession(sessionId),
    refetchOnMount: true, // refetch when stale (e.g. session completed while panel was not open)
  })
  // Track status overrides from SSE stream and mutations independently of query data.
  // This avoids the useState(data?.session.status) bug where the initial value is
  // undefined because the query hasn't resolved yet on first render.
  const [statusOverride, setStatusOverride] = useState<SessionStatus | undefined>()
  const resumeKey = `inbox:resume:${sessionId}`
  const [prompt, setPrompt] = useState(() => {
    try { return localStorage.getItem(resumeKey) ?? "" } catch { return "" }
  })
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Persist resume draft on every change
  useEffect(() => {
    try { localStorage.setItem(resumeKey, prompt) } catch {}
  }, [resumeKey, prompt])

  // Auto-grow textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [prompt])

  // Stream for live updates
  const stream = useSessionStream(sessionId)

  // Reset local overrides when navigating to a different session
  useEffect(() => {
    setStatusOverride(undefined)
    try { setPrompt(localStorage.getItem(resumeKey) ?? "") } catch { setPrompt("") }
  }, [sessionId])

  // Update status override from stream
  useEffect(() => {
    if (stream.sessionStatus) setStatusOverride(stream.sessionStatus as SessionStatus)
  }, [stream.sessionStatus])

  const resumeMutation = useMutation({
    mutationFn: (p: string) => resumeSession(sessionId, p),
    onSuccess: () => {
      try { localStorage.removeItem(resumeKey) } catch {}
      setPrompt("")
      setStatusOverride("running")
      qc.invalidateQueries({ queryKey: ["sessions"] })
    },
    onError: (err: any) => console.error("Failed to resume session:", err),
  })

  const abortMutation = useMutation({
    mutationFn: () => abortSession(sessionId),
    onSuccess: () => {
      setStatusOverride("complete")
      qc.invalidateQueries({ queryKey: ["sessions"] })
      qc.invalidateQueries({ queryKey: ["session", sessionId] })
    },
    onError: (err: any) => console.error("Failed to abort session:", err),
  })

  const archiveMutation = useMutation({
    mutationFn: () => archiveSession(sessionId),
    onSuccess: () => {
      handleBack()
      qc.invalidateQueries({ queryKey: ["sessions"] })
      qc.invalidateQueries({ queryKey: ["session", sessionId] })
    },
    onError: (err: any) => console.error("Failed to archive session:", err),
  })

  const [isEditing, setIsEditing] = useState(false)
  const [editTitle, setEditTitle] = useState("")

  const renameMutation = useMutation({
    mutationFn: (newTitle: string) => updateSession(sessionId, { summary: newTitle }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["session", sessionId] })
      qc.invalidateQueries({ queryKey: ["sessions"] })
    },
  })

  function handleStartEdit() {
    setEditTitle(data?.session.summary || data?.session.prompt?.slice(0, 80) || displayTitle)
    setIsEditing(true)
  }

  function handleFinishEdit() {
    setIsEditing(false)
    const trimmed = editTitle.trim()
    if (trimmed && trimmed !== displayTitle) {
      renameMutation.mutate(trimmed)
    }
  }

  function handleEditKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault()
      handleFinishEdit()
    }
    if (e.key === "Escape") {
      setIsEditing(false)
    }
  }

  const status = statusOverride ?? data?.session.status
  const initialMessages = data?.messages ?? []
  const loading = isLoading
  const error = queryError?.message ?? null

  // Prefer the linked item title (email subject / task title) over whatever title was passed in
  const displayTitle = data?.session.linkedItemTitle || title || "Session"

  // Merge initial messages with streamed ones
  const allMessages = stream.messages.length > 0 ? stream.messages : initialMessages

  const [visibility, setVisibility] = usePreference<TranscriptVisibility>(
    "sessions.transcript.visibility",
    DEFAULT_TRANSCRIPT_VISIBILITY,
  )

  function toggleVisibility(key: keyof TranscriptVisibility) {
    setVisibility({ ...visibility, [key]: !visibility[key] })
  }

  const isRunning = status === "running"
  const isAwaitingInput = status === "awaiting_user_input" || !!stream.pendingQuestion
  const sending = resumeMutation.isPending

  async function handleAnswer(answers: Record<string, string>) {
    await answerSessionQuestion(sessionId, answers)
    stream.clearPendingQuestion()
    setStatusOverride("running")
    qc.invalidateQueries({ queryKey: ["sessions"] })
  }

  function handleSend() {
    if (!prompt.trim() || sending) return
    resumeMutation.mutate(prompt)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const header = (
    <PanelHeader
      left={
        <>
          {isFromSidebar ? (
            <SidebarButton />
          ) : (
            <BackButton onClick={handleBack} />
          )}
          {isEditing ? (
            <input
              autoFocus
              onFocus={(e) => e.target.select()}
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onBlur={handleFinishEdit}
              onKeyDown={handleEditKeyDown}
              className="font-semibold text-sm bg-transparent border-b border-foreground/30 outline-none min-w-0 w-full"
              maxLength={200}
            />
          ) : (
            <h2
              className="font-semibold text-sm truncate min-w-0 cursor-pointer hover:text-foreground/70"
              onClick={handleStartEdit}
              title="Click to rename"
            >
              {displayTitle}
            </h2>
          )}
        </>
      }
      right={
        <div className="flex items-center gap-1">
          {isRunning && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => abortMutation.mutate()}
              disabled={abortMutation.isPending}
            >
              <Square className="h-3 w-3 mr-1" />
              Stop
            </Button>
          )}
          <button
            type="button"
            className="shrink-0 p-1.5 rounded-md hover:bg-secondary text-muted-foreground"
            onClick={() => archiveMutation.mutate()}
            disabled={archiveMutation.isPending}
            title="Archive session"
          >
            <Archive className="h-4 w-4" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className="shrink-0 p-1.5 rounded-md hover:bg-secondary text-muted-foreground"
                />
              }
            >
              <Ellipsis className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Transcript</DropdownMenuLabel>
                <DropdownMenuCheckboxItem
                  checked={visibility.messages}
                  onCheckedChange={() => toggleVisibility("messages")}
                >
                  Messages
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={visibility.toolCalls}
                  onCheckedChange={() => toggleVisibility("toolCalls")}
                >
                  Tool calls
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={visibility.thinking}
                  onCheckedChange={() => toggleVisibility("thinking")}
                >
                  Thinking
                </DropdownMenuCheckboxItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {!isFromSidebar && (
            <button
              type="button"
              className="hidden md:flex shrink-0 p-1.5 rounded-md hover:bg-secondary text-muted-foreground"
              onClick={handleBack}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      }
    />
  )

  if (loading || !data) {
    return (
      <div className="flex flex-col h-full">
        {header}
        <PanelSkeleton />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col h-full">
        {header}
        <div className="p-6 text-destructive">Error loading session: {error}</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {header}

      {/* Transcript */}
      <div className="flex-1 overflow-hidden">
        <SessionTranscript
          messages={allMessages}
          isStreaming={isRunning}
          status={status}
          messageCount={data.session.messageCount}
          isLive={stream.connected}
          visibility={visibility}
          sessionId={sessionId}
        />
      </div>

      {/* Chat input / AskUserPanel */}
      {isAwaitingInput && stream.pendingQuestion ? (
        <AskUserPanel pendingQuestion={stream.pendingQuestion} onSubmit={handleAnswer} />
      ) : (
        <div className="border-t px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="flex gap-2 items-end">
            <Textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isRunning ? "Session is running..." : "Write a prompt..."}
              disabled={isRunning || sending}
              className="min-h-10 max-h-[120px] resize-none overflow-hidden [field-sizing:normal]"
              rows={1}
            />
            <Button
              onClick={handleSend}
              disabled={!prompt.trim() || isRunning || sending}
              size="icon-lg"
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
