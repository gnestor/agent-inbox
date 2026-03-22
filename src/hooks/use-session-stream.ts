import { useState, useEffect, useRef, useCallback } from "react"
import type { SessionMessage, PendingQuestion } from "@/types"

export function useSessionStream(sessionId: string | undefined, enabled = true) {
  const [messages, setMessages] = useState<SessionMessage[]>([])
  const [connected, setConnected] = useState(false)
  const [sessionStatus, setSessionStatus] = useState<string | null>(null)
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const seenSequences = useRef(new Set<number>())

  useEffect(() => {
    seenSequences.current.clear()
    setMessages([])
    setSessionStatus(null)
    setPendingQuestion(null)
    setConnected(false)

    if (!sessionId || !enabled) return

    const es = new EventSource(`/api/sessions/${sessionId}/stream`)
    eventSourceRef.current = es

    es.addEventListener("message", (event) => {
      if (!event.data) return
      try {
        const data = JSON.parse(event.data)

        if (data.type === "session_complete") {
          setSessionStatus("complete")
          setPendingQuestion(null)
          return
        }
        if (data.type === "session_error") {
          setSessionStatus("errored")
          setPendingQuestion(null)
          return
        }
        if (data.type === "ask_user_question") {
          setSessionStatus("awaiting_user_input")
          setPendingQuestion({ questions: data.questions })
          return
        }

        if (data.sequence !== undefined && data.message) {
          if (seenSequences.current.has(data.sequence)) return
          seenSequences.current.add(data.sequence)
          setMessages((prev) => [
            ...prev,
            {
              id: data.sequence,
              sessionId: sessionId,
              sequence: data.sequence,
              type: data.message.type || "unknown",
              message: data.message,
              createdAt: new Date().toISOString(),
            },
          ])
        }
      } catch {
        // Ignore parse errors
      }
    })

    es.addEventListener("open", () => setConnected(true))
    es.addEventListener("error", () => setConnected(false))

    return () => {
      es.close()
      eventSourceRef.current = null
    }
  }, [enabled, sessionId])

  const disconnect = useCallback(() => {
    eventSourceRef.current?.close()
    eventSourceRef.current = null
    setConnected(false)
  }, [])

  const clearPendingQuestion = useCallback(() => setPendingQuestion(null), [])

  return { messages, connected, sessionStatus, pendingQuestion, disconnect, clearPendingQuestion }
}
