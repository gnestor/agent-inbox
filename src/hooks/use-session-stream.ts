import { useEffect, useRef, useState, useCallback } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useWsStream } from "@/hooks/use-ws-stream"
import type { Session, PendingQuestion, PresenceUser, SessionMessage } from "@/types"
import { normalizeMessagePayload, getMessageType } from "@/types/session-message"

type SessionQueryData = { session: Session; messages: SessionMessage[] }
type SessionStatusFromStream = "complete" | "errored" | "awaiting_user_input" | null

// Push message updates directly to React Query cache; lifecycle status lives
// in session.status (updated optimistically in resumeSession and via the
// session_complete/session_error WS events below).

export function useSessionStream(
  sessionId: string | undefined,
  enabled = true,
  onStreamEvent?: (data: any) => void,
) {
  const queryClient = useQueryClient()
  const { subscribe, isConnected } = useWsStream()
  const [sessionStatus, setSessionStatus] = useState<SessionStatusFromStream>(null)
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null)
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([])
  const [eventCount, setEventCount] = useState(0)
  const seenSequences = useRef(new Set<number>())
  const onStreamEventRef = useRef(onStreamEvent)
  onStreamEventRef.current = onStreamEvent

  useEffect(() => {
    seenSequences.current.clear()
    setSessionStatus(null)
    setPendingQuestion(null)
    setPresenceUsers([])
    setEventCount(0)

    if (!sessionId || !enabled) return

    // Seed seenSequences from REST cache to avoid re-processing replayed events
    const cached = queryClient.getQueryData<SessionQueryData>(["session", sessionId])
    if (cached?.messages) {
      for (const m of cached.messages) {
        if (m.sequence >= 0) seenSequences.current.add(m.sequence)
      }
    }

    return subscribe(sessionId, (data) => {
      console.log("[ws-event]", data.type ?? data.message?.type ?? "seq:" + data.sequence, data)
      setEventCount((c) => c + 1)

      if (data.type === "session_complete" || data.type === "session_error") {
        const newStatus = data.type === "session_complete" ? "complete" : "errored"
        setSessionStatus(newStatus)
        queryClient.setQueryData(["session", sessionId], (old: SessionQueryData | undefined) => {
          if (!old || old.session.status === newStatus) return old
          return { ...old, session: { ...old.session, status: newStatus } }
        })
        return
      }
      if (data.type === "ask_user_question") {
        setPendingQuestion({ questions: data.questions })
        setSessionStatus("awaiting_user_input")
        return
      }
      if (data.type === "presence") {
        setPresenceUsers(data.users ?? [])
        return
      }

      // Divert stream_event messages to the partial message handler.
      // Server broadcasts as { sequence, message } — the type is inside message, not at top level.
      // Don't add stream_event sequences to seenSequences — they don't need dedup
      // and tracking them doesn't interfere with complete message dedup (different sequences).
      if (data.message?.type === "stream_event" && onStreamEventRef.current) {
        onStreamEventRef.current(data.message)
        return
      }

      if (data.sequence !== undefined && data.message) {
        if (seenSequences.current.has(data.sequence)) return
        seenSequences.current.add(data.sequence)

        const msg: SessionMessage = {
          id: data.sequence,
          sessionId,
          sequence: data.sequence,
          type: getMessageType(data.message),
          message: normalizeMessagePayload(data.message),
          createdAt: new Date().toISOString(),
        }

        queryClient.setQueryData(["session", sessionId], (old: SessionQueryData | undefined) => {
          if (!old) return old
          const messages = old.messages ?? []
          // Guard against REST-fetch race: seenSequences is WS-scoped, cache may have it from REST
          if (messages.some((m) => m.sequence === data.sequence)) return old
          // Replace optimistic user message with server-assigned one
          const base = msg.type === "user" && messages.some((m) => m.sequence < 0 && m.type === "user")
            ? messages.filter((m) => !(m.sequence < 0 && m.type === "user"))
            : messages
          return { ...old, messages: [...base, msg] }
        })
      }
    })
  }, [enabled, sessionId, queryClient, subscribe])

  const clearPendingQuestion = useCallback(() => {
    setPendingQuestion(null)
    setSessionStatus(null)
  }, [])

  return {
    connected: isConnected,
    sessionStatus,
    pendingQuestion,
    presenceUsers,
    eventCount,
    clearPendingQuestion,
  }
}
