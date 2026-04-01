import { useReducer, useEffect, useRef, useCallback, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import type { PendingQuestion, PresenceUser, SessionMessage } from "@/types"
import { normalizeMessagePayload, getMessageType } from "@/types/session-message"

// ---------------------------------------------------------------------------
// State machine — tracks connection status, session lifecycle, and pending questions.
// Messages are pushed directly to the React Query cache (not accumulated here).
// ---------------------------------------------------------------------------

type StreamState =
  | { status: "idle"; connected: false; sessionStatus: null; pendingQuestion: null }
  | { status: "connected"; connected: true; sessionStatus: null; pendingQuestion: null }
  | { status: "streaming"; connected: true; sessionStatus: null; pendingQuestion: null }
  | { status: "awaiting_input"; connected: true; sessionStatus: "awaiting_user_input"; pendingQuestion: PendingQuestion }
  | { status: "complete"; connected: true; sessionStatus: "complete"; pendingQuestion: null }
  | { status: "errored"; connected: true; sessionStatus: "errored"; pendingQuestion: null }
  | { status: "disconnected"; connected: false; sessionStatus: string | null; pendingQuestion: null }

type StreamAction =
  | { type: "RESET" }
  | { type: "CONNECTED" }
  | { type: "STREAMING" }
  | { type: "ASK_USER"; pendingQuestion: PendingQuestion }
  | { type: "CLEAR_QUESTION" }
  | { type: "COMPLETE" }
  | { type: "ERROR" }
  | { type: "DISCONNECTED" }

const INITIAL_STATE: StreamState = {
  status: "idle",
  connected: false,
  sessionStatus: null,
  pendingQuestion: null,
}

function streamReducer(state: StreamState, action: StreamAction): StreamState {
  switch (action.type) {
    case "RESET":
      return INITIAL_STATE
    case "CONNECTED":
      return { ...state, status: "connected", connected: true, sessionStatus: null, pendingQuestion: null }
    case "STREAMING":
      return { ...state, status: "streaming", connected: true, sessionStatus: null, pendingQuestion: null }
    case "ASK_USER":
      return { ...state, status: "awaiting_input", connected: true, sessionStatus: "awaiting_user_input", pendingQuestion: action.pendingQuestion }
    case "CLEAR_QUESTION":
      return { ...state, status: "streaming", connected: true, sessionStatus: null, pendingQuestion: null }
    case "COMPLETE":
      return { ...state, status: "complete", connected: true, sessionStatus: "complete", pendingQuestion: null }
    case "ERROR":
      return { ...state, status: "errored", connected: true, sessionStatus: "errored", pendingQuestion: null }
    case "DISCONNECTED":
      return { ...state, status: "disconnected", connected: false, pendingQuestion: null }
    default:
      return state
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSessionStream(sessionId: string | undefined, enabled = true) {
  const queryClient = useQueryClient()
  const [state, dispatch] = useReducer(streamReducer, INITIAL_STATE)
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([])
  const [eventCount, setEventCount] = useState(0)
  const eventSourceRef = useRef<EventSource | null>(null)
  const seenSequences = useRef(new Set<number>())

  useEffect(() => {
    seenSequences.current.clear()
    dispatch({ type: "RESET" })
    setPresenceUsers([])
    setEventCount(0)

    if (!sessionId || !enabled) return

    const es = new EventSource(`/api/sessions/${sessionId}/stream`)
    eventSourceRef.current = es

    es.addEventListener("message", (event) => {
      if (!event.data) return
      try {
        const data = JSON.parse(event.data)
        setEventCount((c) => c + 1)

        if (data.type === "session_complete") {
          dispatch({ type: "COMPLETE" })
          // Update session status in React Query cache
          queryClient.setQueryData(["session", sessionId], (old: any) => {
            if (!old) return old
            return { ...old, session: { ...old.session, status: "complete" } }
          })
          queryClient.invalidateQueries({ queryKey: ["sessions"] })
          return
        }
        if (data.type === "session_error") {
          dispatch({ type: "ERROR" })
          queryClient.setQueryData(["session", sessionId], (old: any) => {
            if (!old) return old
            return { ...old, session: { ...old.session, status: "errored" } }
          })
          queryClient.invalidateQueries({ queryKey: ["sessions"] })
          return
        }
        if (data.type === "ask_user_question") {
          dispatch({ type: "ASK_USER", pendingQuestion: { questions: data.questions } })
          return
        }
        if (data.type === "presence") {
          setPresenceUsers(data.users ?? [])
          return
        }

        // Push message to React Query cache (single source of truth)
        if (data.sequence !== undefined && data.message) {
          if (seenSequences.current.has(data.sequence)) return
          seenSequences.current.add(data.sequence)

          dispatch({ type: "STREAMING" })

          const msg: SessionMessage = {
            id: data.sequence,
            sessionId: sessionId,
            sequence: data.sequence,
            type: getMessageType(data.message),
            message: normalizeMessagePayload(data.message),
            createdAt: new Date().toISOString(),
          }

          queryClient.setQueryData(["session", sessionId], (old: any) => {
            if (!old) return old
            const messages = old.messages ?? []
            if (messages.some((m: SessionMessage) => m.sequence === data.sequence)) return old
            return { ...old, messages: [...messages, msg].sort((a: SessionMessage, b: SessionMessage) => a.sequence - b.sequence) }
          })
        }
      } catch {
        // Ignore parse errors
      }
    })

    es.addEventListener("open", () => {
      dispatch({ type: "CONNECTED" })
    })
    es.addEventListener("error", () => {
      dispatch({ type: "DISCONNECTED" })
      // Refetch true DB status when SSE disconnects
      queryClient.invalidateQueries({ queryKey: ["session", sessionId] })
    })

    return () => {
      es.close()
      eventSourceRef.current = null
    }
  }, [enabled, sessionId, queryClient])

  const disconnect = useCallback(() => {
    eventSourceRef.current?.close()
    eventSourceRef.current = null
    dispatch({ type: "DISCONNECTED" })
  }, [])

  const clearPendingQuestion = useCallback(() => dispatch({ type: "CLEAR_QUESTION" }), [])

  return {
    connected: state.connected,
    sessionStatus: state.sessionStatus,
    pendingQuestion: state.pendingQuestion,
    presenceUsers,
    eventCount,
    disconnect,
    clearPendingQuestion,
  }
}
