import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Button, Textarea } from "@hammies/frontend/components/ui"
import { Send, Square, Loader2 } from "lucide-react"
import { getSession, resumeSession, abortSession, answerSessionQuestion } from "@/api/client"
import type { SessionStatus } from "@/types"
import { useSessionStream } from "@/hooks/use-session-stream"
import { useSpatialNav, buildUrl } from "@/hooks/use-spatial-nav"
import { SessionTranscript } from "./SessionTranscript"
import { AskUserPanel } from "./AskUserPanel"
import { PanelHeader, BackButton } from "@/components/shared/PanelHeader"
import { PanelSkeleton } from "@/components/shared/PanelSkeleton"

interface SessionViewProps {
  sessionId: string
  title?: string
}

export function SessionView({ sessionId, title }: SessionViewProps) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { activeTab, persistedState } = useSpatialNav()
  const parentPath = buildUrl(activeTab, { selectedId: persistedState[activeTab].selectedId })
  const { data, isLoading, error: queryError } = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => getSession(sessionId),
  })
  // Track status overrides from SSE stream and mutations independently of query data.
  // This avoids the useState(data?.session.status) bug where the initial value is
  // undefined because the query hasn't resolved yet on first render.
  const [statusOverride, setStatusOverride] = useState<SessionStatus | undefined>()
  const [prompt, setPrompt] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Stream for live updates
  const stream = useSessionStream(sessionId)

  // Reset local overrides when navigating to a different session
  useEffect(() => {
    setStatusOverride(undefined)
  }, [sessionId])

  // Update status override from stream
  useEffect(() => {
    if (stream.sessionStatus) setStatusOverride(stream.sessionStatus as SessionStatus)
  }, [stream.sessionStatus])

  const resumeMutation = useMutation({
    mutationFn: (p: string) => resumeSession(sessionId, p),
    onSuccess: () => {
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

  const status = statusOverride ?? data?.session.status
  const initialMessages = data?.messages ?? []
  const loading = isLoading
  const error = queryError?.message ?? null

  // Merge initial messages with streamed ones
  const allMessages = stream.messages.length > 0 ? stream.messages : initialMessages

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
          <BackButton onClick={() => navigate(parentPath)} />
          <h2 className="font-semibold text-sm truncate min-w-0">{title || "Session"}</h2>
        </>
      }
      right={
        isRunning ? (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => abortMutation.mutate()}
            disabled={abortMutation.isPending}
          >
            <Square className="h-3 w-3 mr-1" />
            Stop
          </Button>
        ) : undefined
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
        />
      </div>

      {/* Chat input / AskUserPanel */}
      {isAwaitingInput && stream.pendingQuestion ? (
        <AskUserPanel pendingQuestion={stream.pendingQuestion} onSubmit={handleAnswer} />
      ) : (
        <div className="border-t p-3">
          <div className="flex gap-2">
            <Textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isRunning ? "Session is running..." : "Write a prompt..."}
              disabled={isRunning || sending}
              className="min-h-[40px] max-h-[120px] resize-none"
              rows={1}
            />
            <Button
              onClick={handleSend}
              disabled={!prompt.trim() || isRunning || sending}
              size="icon"
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
