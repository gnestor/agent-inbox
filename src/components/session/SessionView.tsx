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
import { useUser } from "@/hooks/use-user"
import { SessionTranscript } from "./SessionTranscript"
import { AskUserPanel } from "./AskUserPanel"
import { PanelHeader, BackButton, SidebarButton } from "@/components/shared/PanelHeader"
import { PanelSkeleton } from "@/components/shared/PanelSkeleton"
import { useSessionPhase } from "@/hooks/use-session-phase"
import { useSessionView } from "@/hooks/use-session-view"
import { getInitials } from "@/lib/formatters"

interface SessionViewProps {
  sessionId: string
  title?: string
}

export function SessionView({ sessionId, title }: SessionViewProps) {
  const { user } = useUser()

  const { phase, session, messages, presenceUsers, isLive, mutations, resumeSession, answerQuestion } =
    useSessionPhase({
      sessionId,
      onResume: () => setPrompt(""),
      onArchive: () => handleBack(),
    })

  const {
    isEditing, editTitle, displayTitle,
    handleStartEdit, handleFinishEdit, handleEditKeyDown, setEditTitle,
    visibility, toggleVisibility,
    prompt, setPrompt, textareaRef,
    isStreaming, isSending,
    handleSend, handleKeyDown,
    handleBack, handleOpenPanel, isFromSidebar,
  } = useSessionView({ sessionId, title, session, phase, mutations, resumeSession })

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
          onAction={(intent) => resumeSession(intent)}
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
              placeholder={isStreaming ? "Interrupt with a message..." : "Write a prompt..."}
              disabled={isSending}
              className="min-h-10 max-h-[120px] resize-none overflow-x-hidden [field-sizing:content]"
              rows={1}
            />
            {isStreaming && !prompt.trim() ? (
              <Button
                onClick={() => mutations.abort.mutate()}
                disabled={mutations.abort.isPending}
                variant="destructive"
                size="icon-lg"
              >
                <Square className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                onClick={handleSend}
                disabled={!prompt.trim() || isSending}
                size="icon-lg"
              >
                {isSending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
