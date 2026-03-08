import { useState, useEffect, useRef, useCallback } from "react"
import type { SessionMessage } from "@/types"

export function useSessionStream(sessionId: string | undefined) {
  const [messages, setMessages] = useState<SessionMessage[]>([])
  const [connected, setConnected] = useState(false)
  const [sessionStatus, setSessionStatus] = useState<string | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const seenSequences = useRef(new Set<number>())

  useEffect(() => {
    if (!sessionId) return

    seenSequences.current.clear()
    const es = new EventSource(`/api/sessions/${sessionId}/stream`)
    eventSourceRef.current = es

    es.addEventListener("message", (event) => {
      if (!event.data) return
      try {
        const data = JSON.parse(event.data)

        if (data.type === "session_complete") {
          setSessionStatus("complete")
          return
        }
        if (data.type === "session_error") {
          setSessionStatus("errored")
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
  }, [sessionId])

  const disconnect = useCallback(() => {
    eventSourceRef.current?.close()
    eventSourceRef.current = null
    setConnected(false)
  }, [])

  return { messages, connected, sessionStatus, disconnect }
}
