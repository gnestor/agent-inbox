import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { Button, Textarea } from "@hammies/frontend/components/ui"
import { Send, Square, Loader2 } from "lucide-react"
import { getSession, resumeSession, abortSession } from "@/api/client"
import { useSessionStream } from "@/hooks/use-session-stream"
import { useSpatialNav, buildUrl } from "@/hooks/use-spatial-nav"
import { SessionTranscript } from "./SessionTranscript"
import { PanelHeader, BackButton } from "@/components/shared/PanelHeader"
import type { Session, SessionMessage } from "@/types"

interface SessionViewProps {
  sessionId: string
}

export function SessionView({ sessionId }: SessionViewProps) {
  const navigate = useNavigate()
  const { activeTab, persistedState } = useSpatialNav()
  const parentPath = buildUrl(activeTab, { selectedId: persistedState[activeTab].selectedId })
  const [session, setSession] = useState<Session | null>(null)
  const [initialMessages, setInitialMessages] = useState<SessionMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [prompt, setPrompt] = useState("")
  const [sending, setSending] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Stream for live updates
  const stream = useSessionStream(sessionId)

  // Load session data
  useEffect(() => {
    setLoading(true)
    setError(null)
    getSession(sessionId)
      .then((data) => {
        setSession(data.session)
        setInitialMessages(data.messages)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [sessionId])

  // Update session status from stream
  useEffect(() => {
    if (stream.sessionStatus) {
      setSession((prev) =>
        prev ? { ...prev, status: stream.sessionStatus as any } : prev,
      )
    }
  }, [stream.sessionStatus])

  // Merge initial messages with streamed ones
  const allMessages =
    stream.messages.length > 0 ? stream.messages : initialMessages

  const isRunning = session?.status === "running"

  async function handleSend() {
    if (!prompt.trim() || sending) return
    setSending(true)

    try {
      await resumeSession(sessionId, prompt)
      setPrompt("")
      setSession((prev) => (prev ? { ...prev, status: "running" } : prev))
    } catch (err: any) {
      console.error("Failed to resume session:", err)
    } finally {
      setSending(false)
    }
  }

  async function handleAbort() {
    try {
      await abortSession(sessionId)
      setSession((prev) => (prev ? { ...prev, status: "complete" } : prev))
    } catch (err: any) {
      console.error("Failed to abort session:", err)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  if (loading) return null

  if (error) {
    return (
      <div className="p-6 text-destructive">Error loading session: {error}</div>
    )
  }

  if (!session) return null

  return (
    <div className="flex flex-col h-full">
      <PanelHeader
        left={<><BackButton onClick={() => navigate(parentPath)} /><h2 className="font-semibold text-sm truncate min-w-0">{session.summary || "Session"}</h2></>}
        right={isRunning ? (
          <Button variant="destructive" size="sm" onClick={handleAbort}>
            <Square className="h-3 w-3 mr-1" />
            Stop
          </Button>
        ) : undefined}
      />

      {/* Transcript */}
      <div className="flex-1 overflow-hidden">
        <SessionTranscript
          messages={allMessages}
          isStreaming={isRunning}
          status={session.status}
          messageCount={session.messageCount}
          isLive={stream.connected}
        />
      </div>

      {/* Chat input */}
      <div className="border-t p-3">
        <div className="flex gap-2">
          <Textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isRunning
                ? "Session is running..."
                : "Send a message to resume this session..."
            }
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
    </div>
  )
}
