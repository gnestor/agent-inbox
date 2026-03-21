import { useState, useRef, useCallback, useMemo } from "react"
import { useLocalDraft } from "@/hooks/use-local-draft"
import { useLocation } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Button,
  Textarea,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuCheckboxItem,
  Avatar,
  AvatarImage,
  AvatarFallback,
} from "@hammies/frontend/components/ui"
import { Send, Square, Loader2, X, Ellipsis, Archive } from "lucide-react"
import { getSession, answerSessionQuestion } from "@/api/client"
import { useSessionStream } from "@/hooks/use-session-stream"
import type { OutputSpec } from "./OutputRenderer"
import { useNavigation } from "@/hooks/use-navigation"
import { useUser } from "@/hooks/use-user"
import { SessionTranscript, DEFAULT_TRANSCRIPT_VISIBILITY } from "./SessionTranscript"
import type { TranscriptVisibility } from "./SessionTranscript"
import { AskUserPanel } from "./AskUserPanel"
import { PanelHeader, BackButton, SidebarButton } from "@/components/shared/PanelHeader"
import { PanelSkeleton } from "@/components/shared/PanelSkeleton"
import { usePreference } from "@/hooks/use-preferences"
import { useSessionMutations } from "@/hooks/use-session-mutations"
import { getInitials } from "@/lib/formatters"

interface SessionViewProps {
  sessionId: string
  title?: string
}

export function SessionView({ sessionId, title }: SessionViewProps) {
  const location = useLocation()
  const qc = useQueryClient()
  const { activeTab, popPanel, deselectItem, pushPanel } = useNavigation()
  const { user } = useUser()
  const isFromSidebar = location.pathname.startsWith("/recent/")
  const sessionPanelId = `session:${sessionId}`

  function handleBack() {
    if (activeTab === "sessions") {
      deselectItem()
    } else {
      popPanel(sessionPanelId)
    }
  }

  const handleOpenPanel = useCallback((spec: OutputSpec, sequence: number) => {
    pushPanel({
      id: `artifact:${sessionId}:${sequence}`,
      type: "artifact",
      props: { sessionId, sequence, outputType: spec.type, spec },
    })
  }, [sessionId, pushPanel])

  const { data, isLoading, error: queryError } = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => getSession(sessionId),
    refetchOnMount: true,
  })

  const resumeKey = `inbox:resume:${sessionId}`
  const [prompt, setPrompt] = useLocalDraft(resumeKey)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const { resume: resumeMutation, abort: abortMutation, archive: archiveMutation, rename: renameMutation } =
    useSessionMutations({
      sessionId,
      onResume: () => setPrompt(""),
      onArchive: handleBack,
    })

  // Derive status from query cache (optimistically updated by mutations) + stream
  const status = (data?.session.status as string) ?? undefined
  const shouldStream =
    status === "running" ||
    status === "awaiting_user_input"

  const stream = useSessionStream(sessionId, shouldStream)
  const { presenceUsers } = stream

  // Stream status takes priority when connected (real-time updates)
  const effectiveStatus = stream.sessionStatus ?? status

  const [isEditing, setIsEditing] = useState(false)
  const [editTitle, setEditTitle] = useState("")

  const displayTitle = data?.session.linkedItemTitle || title || "Session"

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

  const initialMessages = data?.messages ?? []
  const loading = isLoading
  const error = queryError?.message ?? null

  const allMessages = useMemo(() => {
    const merged = new Map<number, typeof initialMessages[number]>()
    for (const message of initialMessages) merged.set(message.sequence, message)
    for (const message of stream.messages) merged.set(message.sequence, message)
    return [...merged.values()].sort((a, b) => a.sequence - b.sequence)
  }, [initialMessages, stream.messages])

  const [visibility, setVisibility] = usePreference<TranscriptVisibility>(
    "sessions.transcript.visibility",
    DEFAULT_TRANSCRIPT_VISIBILITY,
  )

  function toggleVisibility(key: keyof TranscriptVisibility) {
    setVisibility({ ...visibility, [key]: !visibility[key] })
  }

  const isRunning = effectiveStatus === "running"
  const isAwaitingInput = effectiveStatus === "awaiting_user_input" || !!stream.pendingQuestion
  const sending = resumeMutation.isPending

  async function handleAnswer(answers: Record<string, string>) {
    await answerSessionQuestion(sessionId, answers)
    stream.clearPendingQuestion()
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
          {presenceUsers.length > 1 && (
            <div className="flex -space-x-1.5 shrink-0">
              {presenceUsers.map((u) => (
                <Avatar key={u.email} size="sm" className="border-2 border-background">
                  {u.picture && <AvatarImage src={u.picture} alt={u.name} />}
                  <AvatarFallback className="text-[10px]">{getInitials(u.name)}</AvatarFallback>
                </Avatar>
              ))}
            </div>
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
                <DropdownMenuCheckboxItem
                  checked={visibility.artifacts}
                  onCheckedChange={() => toggleVisibility("artifacts")}
                >
                  Artifacts
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
          key={sessionId}
          messages={allMessages}
          isStreaming={isRunning}
          status={effectiveStatus}
          messageCount={data.session.messageCount}
          isLive={stream.connected}
          visibility={visibility}
          sessionId={sessionId}
          currentUserEmail={user?.email}
          onOpenPanel={handleOpenPanel}
          onAction={(intent) => resumeMutation.mutate(intent)}
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
              className="min-h-10 max-h-[120px] resize-none overflow-x-hidden [field-sizing:content]"
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
