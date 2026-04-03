import { useState, useCallback, useEffect } from "react"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuCheckboxItem,
  Avatar,
  AvatarImage,
  AvatarFallback,
  Skeleton,
} from "@hammies/frontend/components/ui"
import { X, Ellipsis, Archive, ArchiveRestore } from "lucide-react"
import { useUser } from "@/hooks/use-user"
import { SessionInput } from "./SessionInput"
import { SessionTranscript, WorkingIndicator, DEFAULT_TRANSCRIPT_VISIBILITY } from "./SessionTranscript"
import type { TranscriptVisibility } from "./SessionTranscript"
import { PanelHeader, BackButton, SidebarButton } from "@/components/shared/PanelHeader"
import { PanelSkeleton } from "@/components/shared/PanelSkeleton"
import { useSessionController } from "@/hooks/use-session-controller"
import { useSessionView } from "@/hooks/use-session-view"
import { usePreference } from "@/hooks/use-preferences"
import { getInitials } from "@/lib/formatters"

interface SessionViewProps {
  sessionId: string
  panelId: string
  title?: string
}

// Bounded cache: track which sessions have finished loading artifacts.
// Cap at 100 to prevent unbounded growth over long SPA sessions.
const MAX_READY_CACHE = 100
const readySessions = new Set<string>()
function markReady(id: string) {
  if (readySessions.size >= MAX_READY_CACHE) {
    const first = readySessions.values().next().value
    if (first) readySessions.delete(first)
  }
  readySessions.add(id)
}

export function SessionView({ sessionId, panelId, title }: SessionViewProps) {
  const { user } = useUser()

  // Visibility is independent — read it first so the controller can filter by it
  const [visibility, setVisibility] = usePreference<TranscriptVisibility>(
    "sessions.transcript.visibility",
    DEFAULT_TRANSCRIPT_VISIBILITY,
  )
  function toggleVisibility(key: keyof TranscriptVisibility) {
    setVisibility({ ...visibility, [key]: !visibility[key] })
  }

  // Controller: data, streaming, actions
  const controller = useSessionController({
    sessionId,
    visibility,
    isActive: true,
    onArchive: () => sessionView.handleBack(),
  })

  // UI state: title editing, input draft, navigation
  const sessionView = useSessionView({
    sessionId,
    panelId,
    title,
    session: controller.session,
    phase: controller.phase,
    mutations: controller.mutations,
  })

  const handleAbort = useCallback(() => controller.mutations.abort.mutate(), [controller.mutations.abort])

  // Skeleton overlay on first load
  const dataReady = controller.session?.id === sessionId
  const [readySessionId, setReadySessionId] = useState<string | null>(null)
  const handleArtifactsReady = useCallback(() => {
    markReady(sessionId)
    setReadySessionId(sessionId)
  }, [sessionId])
  useEffect(() => {
    if (readySessions.has(sessionId)) {
      setReadySessionId(sessionId)
      return
    }
    const timer = setTimeout(() => {
      markReady(sessionId)
      setReadySessionId(sessionId)
    }, 3000)
    return () => clearTimeout(timer)
  }, [sessionId])
  const isReady = dataReady && readySessionId === sessionId

  const header = (
    <PanelHeader
      left={
        <>
          {sessionView.isFromSidebar ? <SidebarButton /> : <BackButton onClick={sessionView.handleBack} />}
          {sessionView.isEditing ? (
            <input
              autoFocus
              onFocus={(e) => e.target.select()}
              value={sessionView.editTitle}
              onChange={(e) => sessionView.setEditTitle(e.target.value)}
              onBlur={sessionView.handleFinishEdit}
              onKeyDown={sessionView.handleEditKeyDown}
              className="font-semibold text-sm bg-transparent border-b border-foreground/30 outline-none truncate min-w-0 flex-1"
              maxLength={200}
            />
          ) : (
            <h2
              className="font-semibold text-sm truncate min-w-0 cursor-pointer hover:text-foreground/70"
              onClick={sessionView.handleStartEdit}
              title="Click to rename"
            >
              {sessionView.displayTitle}
            </h2>
          )}
          {controller.presenceUsers.length > 1 && (
            <div className="flex -space-x-1.5 shrink-0">
              {controller.presenceUsers.map((u) => (
                <Avatar key={u.email} size="sm" className="border-2 border-background">
                  {u.picture && <AvatarImage src={u.picture} alt={u.name} />}
                  <AvatarFallback className="text-[10px]">{getInitials(u.name)}</AvatarFallback>
                </Avatar>
              ))}
            </div>
          )}
        </>
      }
      right={
        <div className="flex items-center gap-1">
          {controller.session?.status === "archived" ? (
            <button type="button" className="shrink-0 p-1.5 rounded-md hover:bg-secondary text-muted-foreground" onClick={() => controller.mutations.unarchive.mutate()} disabled={controller.mutations.unarchive.isPending} title="Restore session">
              <ArchiveRestore className="h-4 w-4" />
            </button>
          ) : (
            <button type="button" className="shrink-0 p-1.5 rounded-md hover:bg-secondary text-muted-foreground" onClick={() => controller.mutations.archive.mutate()} disabled={controller.mutations.archive.isPending} title="Archive session">
              <Archive className="h-4 w-4" />
            </button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger render={<button type="button" className="shrink-0 p-1.5 rounded-md hover:bg-secondary text-muted-foreground" />}>
              <Ellipsis className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Transcript</DropdownMenuLabel>
                <DropdownMenuCheckboxItem checked={visibility.messages} onCheckedChange={() => toggleVisibility("messages")}>Messages</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={visibility.toolCalls} onCheckedChange={() => toggleVisibility("toolCalls")}>Tool calls</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={visibility.thinking} onCheckedChange={() => toggleVisibility("thinking")}>Thinking</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={visibility.artifacts} onCheckedChange={() => toggleVisibility("artifacts")}>Artifacts</DropdownMenuCheckboxItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {!sessionView.isFromSidebar && (
            <button type="button" className="hidden md:flex shrink-0 p-1.5 rounded-md hover:bg-secondary text-muted-foreground" onClick={sessionView.handleBack}>
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      }
    />
  )

  if (controller.phase.status === "error") {
    return (
      <div className="flex flex-col h-full">
        {header}
        <div className="p-6 text-destructive">Error loading session: {controller.phase.message}</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full relative">
      {!isReady && (
        <div className="absolute inset-0 z-10 flex flex-col bg-card">
          <PanelHeader left={<>{sessionView.isFromSidebar ? <SidebarButton /> : <BackButton onClick={sessionView.handleBack} />}<Skeleton className="h-4 w-48 rounded" /></>} />
          <PanelSkeleton />
        </div>
      )}
      {header}

      <div className="flex-1 overflow-hidden">
        <SessionTranscript
          key={sessionId}
          messages={controller.messages}
          lookups={controller.lookups}
          userProfiles={controller.userProfiles}
          visibility={visibility}
          sessionId={sessionId}
          currentUserEmail={user?.email}
          onOpenPanel={sessionView.handleOpenPanel}
          onAction={controller.resumeSession}
          onAnswer={controller.answerQuestion}
          onArtifactsReady={handleArtifactsReady}
        >
          {sessionView.isStreaming && <WorkingIndicator eventCount={controller.eventCount} />}
          {controller.phase.status === "errored" && (
            <div className="mx-4 mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              The agent process exited unexpectedly. You can send another message to retry.
            </div>
          )}
        </SessionTranscript>
      </div>

      <SessionInput
        sessionId={sessionId}
        isStreaming={sessionView.isStreaming}
        isSending={sessionView.isSending}
        onSend={controller.resumeSession}
        onAbort={handleAbort}
        isAbortPending={controller.mutations.abort.isPending}
        attachments={sessionView.attachments}
      />
    </div>
  )
}
