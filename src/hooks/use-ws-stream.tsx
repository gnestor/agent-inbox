import { createContext, useContext, useEffect, useRef, useCallback, useState, type ReactNode } from "react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SessionEventCallback = (data: any) => void

interface WsStreamContextValue {
  /** Subscribe to events for a session. Returns an unsubscribe function. */
  subscribe: (sessionId: string, callback: SessionEventCallback) => () => void
  /** Whether the WebSocket is currently connected */
  isConnected: boolean
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const WsStreamContext = createContext<WsStreamContextValue | null>(null)

export function useWsStream(): WsStreamContextValue {
  const ctx = useContext(WsStreamContext)
  if (!ctx) throw new Error("useWsStream must be used within WsStreamProvider")
  return ctx
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function WsStreamProvider({ children }: { children: ReactNode }) {
  const wsRef = useRef<WebSocket | null>(null)
  const clientIdRef = useRef<string | null>(null)
  const listenersRef = useRef(new Map<string, Set<SessionEventCallback>>())
  const [isConnected, setIsConnected] = useState(false)
  const retriesRef = useRef(0)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const mountedRef = useRef(true)

  // Pending subscribe/unsubscribe batches (debounced)
  const pendingSubscribe = useRef(new Set<string>())
  const pendingUnsubscribe = useRef(new Set<string>())
  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const flushBatch = useCallback(() => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return

    if (pendingSubscribe.current.size > 0) {
      ws.send(JSON.stringify({ type: "subscribe", sessionIds: [...pendingSubscribe.current] }))
      pendingSubscribe.current.clear()
    }
    if (pendingUnsubscribe.current.size > 0) {
      ws.send(JSON.stringify({ type: "unsubscribe", sessionIds: [...pendingUnsubscribe.current] }))
      pendingUnsubscribe.current.clear()
    }
  }, [])

  const scheduleBatch = useCallback(() => {
    if (batchTimerRef.current) clearTimeout(batchTimerRef.current)
    batchTimerRef.current = setTimeout(flushBatch, 50)
  }, [flushBatch])

  const connect = useCallback(() => {
    if (!mountedRef.current) return

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws`)
    wsRef.current = ws

    ws.onopen = () => {
      retriesRef.current = 0
      setIsConnected(true)
    }

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data)

        if (msg.type === "connected") {
          clientIdRef.current = msg.clientId
          // Re-subscribe all active sessions on (re)connect
          const sessionIds = [...listenersRef.current.keys()]
          if (sessionIds.length > 0) {
            ws.send(JSON.stringify({ type: "subscribe", sessionIds }))
          }
          return
        }

        if (msg.type === "session_event" && msg.sessionId) {
          const callbacks = listenersRef.current.get(msg.sessionId)
          if (callbacks) {
            for (const cb of callbacks) cb(msg.data)
          }
        }
      } catch { /* ignore parse errors */ }
    }

    ws.onclose = () => {
      setIsConnected(false)
      clientIdRef.current = null
      if (!mountedRef.current) return
      // Exponential backoff reconnect: 1s, 2s, 4s, ... 30s
      const delay = Math.min(1000 * 2 ** retriesRef.current, 30000)
      retriesRef.current++
      reconnectTimerRef.current = setTimeout(connect, delay)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    connect()
    return () => {
      mountedRef.current = false
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      if (batchTimerRef.current) clearTimeout(batchTimerRef.current)
      const ws = wsRef.current
      if (ws) {
        // Defer close until open to avoid "closed before established" in StrictMode
        if (ws.readyState === WebSocket.OPEN) ws.close()
        else ws.onopen = () => ws.close()
      }
      wsRef.current = null
    }
  }, [connect])

  const subscribe = useCallback((sessionId: string, callback: SessionEventCallback) => {
    // Add listener
    if (!listenersRef.current.has(sessionId)) {
      listenersRef.current.set(sessionId, new Set())
    }
    const set = listenersRef.current.get(sessionId)!
    set.add(callback)

    // First subscriber for this session — tell server
    if (set.size === 1) {
      // Cancel any pending unsubscribe for this session
      pendingUnsubscribe.current.delete(sessionId)
      pendingSubscribe.current.add(sessionId)
      scheduleBatch()
    }

    // Return unsubscribe function
    return () => {
      set.delete(callback)
      if (set.size === 0) {
        listenersRef.current.delete(sessionId)
        // Last subscriber gone — tell server
        pendingSubscribe.current.delete(sessionId)
        pendingUnsubscribe.current.add(sessionId)
        scheduleBatch()
      }
    }
  }, [scheduleBatch])

  return (
    <WsStreamContext.Provider value={{ subscribe, isConnected }}>
      {children}
    </WsStreamContext.Provider>
  )
}
