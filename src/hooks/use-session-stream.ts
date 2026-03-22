import { useReducer, useEffect, useRef, useCallback, useState } from "react"
import type { SessionMessage, PendingQuestion, PresenceUser } from "@/types"
import { normalizeMessagePayload, getMessageType } from "@/types/session-message"

// ---------------------------------------------------------------------------
// State machine — prevents impossible states like connected=false + status="awaiting_user_input"
// ---------------------------------------------------------------------------

type StreamState =
  | { status: "idle"; messages: SessionMessage[]; connected: false; sessionStatus: null; pendingQuestion: null }
  | { status: "connected"; messages: SessionMessage[]; connected: true; sessionStatus: null; pendingQuestion: null }
  | { status: "streaming"; messages: SessionMessage[]; connected: true; sessionStatus: null; pendingQuestion: null }
  | { status: "awaiting_input"; messages: SessionMessage[]; connected: true; sessionStatus: "awaiting_user_input"; pendingQuestion: PendingQuestion }
  | { status: "complete"; messages: SessionMessage[]; connected: true; sessionStatus: "complete"; pendingQuestion: null }
  | { status: "errored"; messages: SessionMessage[]; connected: true; sessionStatus: "errored"; pendingQuestion: null }
  | { status: "disconnected"; messages: SessionMessage[]; connected: false; sessionStatus: string | null; pendingQuestion: null }

type StreamAction =
  | { type: "RESET" }
  | { type: "CONNECTED" }
  | { type: "MESSAGE"; message: SessionMessage }
  | { type: "ASK_USER"; pendingQuestion: PendingQuestion }
  | { type: "CLEAR_QUESTION" }
  | { type: "COMPLETE" }
  | { type: "ERROR" }
  | { type: "DISCONNECTED" }

const INITIAL_STATE: StreamState = {
  status: "idle",
  messages: [],
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
    case "MESSAGE":
      return { ...state, status: "streaming", messages: [...state.messages, action.message], connected: true, sessionStatus: null, pendingQuestion: null }
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
  const [state, dispatch] = useReducer(streamReducer, INITIAL_STATE)
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([])
  const eventSourceRef = useRef<EventSource | null>(null)
  const seenSequences = useRef(new Set<number>())

  useEffect(() => {
    seenSequences.current.clear()
    dispatch({ type: "RESET" })
    setPresenceUsers([])

    if (!sessionId || !enabled) return

    const es = new EventSource(`/api/sessions/${sessionId}/stream`)
    eventSourceRef.current = es

    es.addEventListener("message", (event) => {
      if (!event.data) return
      try {
        const data = JSON.parse(event.data)

        if (data.type === "session_complete") {
          dispatch({ type: "COMPLETE" })
          return
        }
        if (data.type === "session_error") {
          dispatch({ type: "ERROR" })
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

        if (data.sequence !== undefined && data.message) {
          if (seenSequences.current.has(data.sequence)) return
          seenSequences.current.add(data.sequence)
          dispatch({
            type: "MESSAGE",
            message: {
              id: data.sequence,
              sessionId: sessionId,
              sequence: data.sequence,
              type: getMessageType(data.message),
              message: normalizeMessagePayload(data.message),
              createdAt: new Date().toISOString(),
            },
          })
        }
      } catch {
        // Ignore parse errors
      }
    })

    es.addEventListener("open", () => dispatch({ type: "CONNECTED" }))
    es.addEventListener("error", () => dispatch({ type: "DISCONNECTED" }))

    return () => {
      es.close()
      eventSourceRef.current = null
    }
  }, [enabled, sessionId])

  const disconnect = useCallback(() => {
    eventSourceRef.current?.close()
    eventSourceRef.current = null
    dispatch({ type: "DISCONNECTED" })
  }, [])

  const clearPendingQuestion = useCallback(() => dispatch({ type: "CLEAR_QUESTION" }), [])

  // Return flat object — same API as before for backward compatibility
  return {
    messages: state.messages,
    connected: state.connected,
    sessionStatus: state.sessionStatus,
    pendingQuestion: state.pendingQuestion,
    presenceUsers,
    disconnect,
    clearPendingQuestion,
  }
}
