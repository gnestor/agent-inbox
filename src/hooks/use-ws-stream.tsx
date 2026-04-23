import { createContext, useContext, useEffect, useRef, useCallback, useState, type ReactNode } from "react"
import {
  useWsConnectionStore,
  getWsConnectionStatus,
} from "@/stores/ws-connection-store"

// Keepalive: detect zombie connections (laptop sleep, NAT drop) that would
// otherwise leave us on a silently-dead socket for minutes before ws.onclose
// fires. We ping every PING_INTERVAL_MS and expect *any* message within
// ALIVE_TIMEOUT_MS; if the window elapses we force-close, which triggers
// the existing reconnect path.
export const PING_INTERVAL_MS = 20_000
export const ALIVE_TIMEOUT_MS = 45_000

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SessionEventCallback = (data: any) => void
type ConnectCallback = () => void
type CursorMissCallback = () => void

/** Per-session subscription options. */
export interface SubscribeOptions {
  /** Called at subscribe/resubscribe time; the returned sequence is sent to
   *  the server so it can replay missed events. Return undefined for a brand
   *  new subscriber with no prior state. */
  getFromSequence?: () => number | undefined
  /** Fired when the server responds with cursor_miss — caller should invalidate
   *  bootstrap and refetch. */
  onCursorMiss?: CursorMissCallback
}

interface WsStreamContextValue {
  /** Subscribe to events for a session. Returns an unsubscribe function. */
  subscribe: (
    sessionId: string,
    callback: SessionEventCallback,
    options?: SubscribeOptions,
  ) => () => void
  /**
   * Register a callback that fires every time the WebSocket (re)opens.
   * If the socket is already open when this is called, the callback fires
   * on the next microtask so callers can rely on connect-driven refetch
   * semantics without a separate "run-on-mount" path.
   *
   * Returns an unregister function.
   */
  onConnect: (callback: ConnectCallback) => () => void
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
  // Per-session subscribe options keyed by sessionId. Latest caller wins for
  // each field — there's normally only one subscriber per session in practice.
  const optionsRef = useRef(new Map<string, SubscribeOptions>())
  const connectListenersRef = useRef(new Set<ConnectCallback>())
  const [isConnected, setIsConnected] = useState(false)
  const retriesRef = useRef(0)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const mountedRef = useRef(true)

  // Pending subscribe/unsubscribe batches (debounced)
  const pendingSubscribe = useRef(new Set<string>())
  const pendingUnsubscribe = useRef(new Set<string>())
  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Keepalive timers (started on open, cleared on close)
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const aliveTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const stopKeepalive = useCallback(() => {
    if (pingIntervalRef.current) clearInterval(pingIntervalRef.current)
    if (aliveTimeoutRef.current) clearTimeout(aliveTimeoutRef.current)
    pingIntervalRef.current = undefined
    aliveTimeoutRef.current = undefined
  }, [])

  const resetAliveTimeout = useCallback(() => {
    if (aliveTimeoutRef.current) clearTimeout(aliveTimeoutRef.current)
    aliveTimeoutRef.current = setTimeout(() => {
      // No traffic for ALIVE_TIMEOUT_MS — assume the socket is dead even if
      // ws.onclose hasn't fired yet. Force close; reconnect logic takes over.
      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) ws.close()
    }, ALIVE_TIMEOUT_MS)
  }, [])

  // Build the rich `sessions` array for a subscribe frame by calling each
  // session's getFromSequence at send-time. Used both by flushBatch and by
  // the `connected` message handler on (re)open.
  const buildSubscribePayload = useCallback((ids: Iterable<string>) => {
    const sessions: Array<{ id: string; fromSequence?: number }> = []
    for (const id of ids) {
      const opts = optionsRef.current.get(id)
      const fromSequence = opts?.getFromSequence?.()
      sessions.push(
        typeof fromSequence === "number" && fromSequence > 0
          ? { id, fromSequence }
          : { id },
      )
    }
    return sessions
  }, [])

  const flushBatch = useCallback(() => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return

    if (pendingSubscribe.current.size > 0) {
      ws.send(JSON.stringify({
        type: "subscribe",
        sessions: buildSubscribePayload(pendingSubscribe.current),
      }))
      pendingSubscribe.current.clear()
    }
    if (pendingUnsubscribe.current.size > 0) {
      ws.send(JSON.stringify({ type: "unsubscribe", sessionIds: [...pendingUnsubscribe.current] }))
      pendingUnsubscribe.current.clear()
    }
  }, [buildSubscribePayload])

  const scheduleBatch = useCallback(() => {
    if (batchTimerRef.current) clearTimeout(batchTimerRef.current)
    batchTimerRef.current = setTimeout(flushBatch, 50)
  }, [flushBatch])

  const connect = useCallback(() => {
    if (!mountedRef.current) return

    useWsConnectionStore.getState().recordAttempt()

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws`)
    wsRef.current = ws

    ws.onopen = () => {
      retriesRef.current = 0
      setIsConnected(true)
      useWsConnectionStore.getState().recordOpened()

      // Start keepalive: periodic pings + "no traffic" watchdog.
      resetAliveTimeout()
      pingIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }))
        }
      }, PING_INTERVAL_MS)

      // Fire all registered onConnect callbacks — this covers both the first
      // connection and every reconnection. Callers (e.g. useSessionTranscript)
      // use this as the signal to run a fresh snapshot.
      for (const cb of connectListenersRef.current) {
        try { cb() } catch (err) { console.error("[ws] onConnect callback threw", err) }
      }
    }

    ws.onmessage = (evt) => {
      // Any message proves the connection is alive — reset the watchdog.
      resetAliveTimeout()

      let msg: any
      try {
        msg = JSON.parse(evt.data)
      } catch (err) {
        console.error("[ws] failed to parse message", err, evt.data)
        return
      }

      // Drop pong frames early — no further handling needed.
      if (msg.type === "pong") return

      if (msg.type === "connected") {
        clientIdRef.current = msg.clientId
        // Re-subscribe all active sessions on (re)connect with cursors.
        const ids = [...listenersRef.current.keys()]
        if (ids.length > 0) {
          ws.send(JSON.stringify({
            type: "subscribe",
            sessions: buildSubscribePayload(ids),
          }))
        }
        return
      }

      if (msg.type === "cursor_miss" && msg.sessionId) {
        const opts = optionsRef.current.get(msg.sessionId)
        try { opts?.onCursorMiss?.() } catch (err) {
          console.error("[ws] onCursorMiss threw", err, msg)
        }
        return
      }

      if (msg.type === "session_event" && msg.sessionId) {
        const callbacks = listenersRef.current.get(msg.sessionId)
        if (callbacks) {
          for (const cb of callbacks) {
            try { cb(msg.data) } catch (err) {
              console.error("[ws] session event callback threw", err, msg)
            }
          }
        }
      }
    }

    ws.onerror = () => {
      useWsConnectionStore.getState().recordErrored("websocket error")
    }

    ws.onclose = (evt) => {
      stopKeepalive()
      setIsConnected(false)
      clientIdRef.current = null
      useWsConnectionStore.getState().recordClosed({ code: evt.code, reason: evt.reason })
      if (!mountedRef.current) return
      // Exponential backoff reconnect: 1s, 2s, 4s, ... 30s
      const delay = Math.min(1000 * 2 ** retriesRef.current, 30000)
      retriesRef.current++
      reconnectTimerRef.current = setTimeout(connect, delay)
    }
  }, [resetAliveTimeout, stopKeepalive, buildSubscribePayload])

  useEffect(() => {
    mountedRef.current = true
    connect()

    const onOnline = () => useWsConnectionStore.getState().setOnline(true)
    const onOffline = () => useWsConnectionStore.getState().setOnline(false)
    if (typeof window !== "undefined") {
      window.addEventListener("online", onOnline)
      window.addEventListener("offline", onOffline)
    }

    return () => {
      mountedRef.current = false
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      if (batchTimerRef.current) clearTimeout(batchTimerRef.current)
      stopKeepalive()
      if (typeof window !== "undefined") {
        window.removeEventListener("online", onOnline)
        window.removeEventListener("offline", onOffline)
      }
      const ws = wsRef.current
      if (ws) {
        // Defer close until open to avoid "closed before established" in StrictMode
        if (ws.readyState === WebSocket.OPEN) ws.close()
        else ws.onopen = () => ws.close()
      }
      wsRef.current = null
    }
  }, [connect])

  const subscribe = useCallback((
    sessionId: string,
    callback: SessionEventCallback,
    options?: SubscribeOptions,
  ) => {
    if (options) optionsRef.current.set(sessionId, options)

    if (!listenersRef.current.has(sessionId)) {
      listenersRef.current.set(sessionId, new Set())
    }
    const set = listenersRef.current.get(sessionId)!
    set.add(callback)

    if (set.size === 1) {
      pendingUnsubscribe.current.delete(sessionId)
      pendingSubscribe.current.add(sessionId)
      scheduleBatch()
    }

    return () => {
      set.delete(callback)
      if (set.size === 0) {
        listenersRef.current.delete(sessionId)
        optionsRef.current.delete(sessionId)
        pendingSubscribe.current.delete(sessionId)
        pendingUnsubscribe.current.add(sessionId)
        scheduleBatch()
      }
    }
  }, [scheduleBatch])

  const onConnect = useCallback((callback: ConnectCallback) => {
    connectListenersRef.current.add(callback)
    // If the socket is already open, fire the callback on next microtask so
    // callers can depend on connect-driven behavior regardless of race with mount.
    if (getWsConnectionStatus().phase === "connected") {
      queueMicrotask(() => {
        if (connectListenersRef.current.has(callback)) callback()
      })
    }
    return () => {
      connectListenersRef.current.delete(callback)
    }
  }, [])

  return (
    <WsStreamContext.Provider value={{ subscribe, onConnect, isConnected }}>
      {children}
    </WsStreamContext.Provider>
  )
}
