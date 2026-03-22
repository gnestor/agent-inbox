import { useState, useRef, useCallback } from "react"
import { useLocalDraft } from "@/hooks/use-local-draft"
import { useLocation } from "react-router-dom"
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
import type { OutputSpec } from "./OutputRenderer"
import { useNavigation } from "@/hooks/use-navigation"
import { useUser } from "@/hooks/use-user"
import { SessionTranscript, DEFAULT_TRANSCRIPT_VISIBILITY } from "./SessionTranscript"
import type { TranscriptVisibility } from "./SessionTranscript"
import { AskUserPanel } from "./AskUserPanel"
import { PanelHeader, BackButton, SidebarButton } from "@/components/shared/PanelHeader"
import { PanelSkeleton } from "@/components/shared/PanelSkeleton"
import { usePreference } from "@/hooks/use-preferences"
import { useSessionPhase } from "@/hooks/use-session-phase"
import { getInitials } from "@/lib/formatters"

interface SessionViewProps {
  sessionId: string
  title?: string
}

export function SessionView({ sessionId, title }: SessionViewProps) {
  const location = useLocation()
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

  const resumeKey = `inbox:resume:${sessionId}`
  const [prompt, setPrompt] = useLocalDraft(resumeKey)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const { phase, session, messages, presenceUsers, isLive, mutations, answerQuestion } =
    useSessionPhase({
      sessionId,
      onResume: () => setPrompt(""),
      onArchive: handleBack,
    })

  const handleOpenPanel = useCallback((spec: OutputSpec, sequence: number) => {
    pushPanel({
      id: `artifact:${sessionId}:${sequence}`,
      type: "artifact",
      props: { sessionId, sequence, outputType: spec.type, spec },
    })
  }, [sessionId, pushPanel])

  const [isEditing, setIsEditing] = useState(false)
  const [editTitle, setEditTitle] = useState("")

  const displayTitle = session?.linkedItemTitle || title || "Session"

  function handleStartEdit() {
    setEditTitle(session?.summary || session?.prompt?.slice(0, 80) || displayTitle)
    setIsEditing(true)
  }

  function handleFinishEdit() {
    setIsEditing(false)
    const trimmed = editTitle.trim()
    if (trimmed && trimmed !== displayTitle) {
      mutations.rename.mutate(trimmed)
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

  const [visibility, setVisibility] = usePreference<TranscriptVisibility>(
    "sessions.transcript.visibility",
    DEFAULT_TRANSCRIPT_VISIBILITY,
  )

  function toggleVisibility(key: keyof TranscriptVisibility) {
    setVisibility({ ...visibility, [key]: !visibility[key] })
  }

  const isStreaming = phase.status === "streaming"
  const isSending = phase.status === "sending"
  const inputDisabled = isStreaming || isSending

  function handleSend() {
    if (!prompt.trim() || inputDisabled) return
    mutations.resume.mutate(prompt)
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
          {isStreaming && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => mutations.abort.mutate()}
              disabled={mutations.abort.isPending}
            >
              <Square className="h-3 w-3 mr-1" />
              Stop
            </Button>
          )}
          <button
            type="button"
            className="shrink-0 p-1.5 rounded-md hover:bg-secondary text-muted-foreground"
            onClick={() => mutations.archive.mutate()}
            disabled={mutations.archive.isPending}
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

  if (phase.status === "loading") {
    return (
      <div className="flex flex-col h-full">
        {header}
        <PanelSkeleton />
      </div>
    )
  }

  if (phase.status === "error") {
    return (
      <div className="flex flex-col h-full">
        {header}
        <div className="p-6 text-destructive">Error loading session: {phase.message}</div>
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
          messages={messages}
          isStreaming={isStreaming}
          status={phase.status}
          messageCount={session?.messageCount}
          isLive={isLive}
          visibility={visibility}
          sessionId={sessionId}
          currentUserEmail={user?.email}
          onOpenPanel={handleOpenPanel}
          onAction={(intent) => mutations.resume.mutate(intent)}
        />
      </div>

      {/* Chat input / AskUserPanel */}
      {phase.status === "awaiting_input" ? (
        <AskUserPanel pendingQuestion={phase.question} onSubmit={answerQuestion} />
      ) : (
        <div className="border-t px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="flex gap-2 items-end">
            <Textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isStreaming ? "Session is running..." : "Write a prompt..."}
              disabled={inputDisabled}
              className="min-h-10 max-h-[120px] resize-none overflow-x-hidden [field-sizing:content]"
              rows={1}
            />
            <Button
              onClick={handleSend}
              disabled={!prompt.trim() || inputDisabled}
              size="icon-lg"
            >
              {isSending ? (
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
