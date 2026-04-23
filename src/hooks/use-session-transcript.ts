import { useEffect, useRef } from "react"
import { getSession } from "@/api/client"
import { useWsStream } from "@/hooks/use-ws-stream"
import {
  useSessionStore,
  type SessionSlice,
} from "@/stores/session-store"
import type { SessionRecoveryReason } from "@/stores/session-recovery"
import { createLogger } from "@/lib/logger"

const log = createLogger("session-transcript")

// Once beginSnapshot returns true, the caller owns the coordinator's inFlight
// token and MUST release it (via applySnapshot or failSnapshot) before
// returning. No early returns on unmount — a late store update is harmless
// because the store is independent of React's mount lifecycle. This matters
// under StrictMode, where the mount → cleanup → remount cycle can race a
// slow fetch; an early return would leak inFlight and cause every subsequent
// WS event to be deferred forever.
async function runSnapshot(sessionId: string, reason: SessionRecoveryReason): Promise<void> {
  const store = useSessionStore.getState()
  if (!store.beginSnapshot(sessionId, reason)) return
  try {
    const data = await getSession(sessionId)
    useSessionStore.getState().applySnapshot(sessionId, data)
  } catch (err) {
    log.error("snapshot fetch failed", { sessionId, reason, err })
    useSessionStore.getState().failSnapshot(sessionId)
  }
}

export function useSessionTranscript(
  sessionId: string | undefined,
): SessionSlice | undefined {
  const slice = useSessionStore((s) => (sessionId ? s.sessions[sessionId] : undefined))
  const { subscribe, onConnect } = useWsStream()
  const runningRef = useRef(false)

  useEffect(() => {
    if (!sessionId) return
    // Reset to "bootstrap" semantics when navigating to a new session.
    runningRef.current = false

    const unsubEvents = subscribe(sessionId, (event) => {
      useSessionStore.getState().ingestEvent(sessionId, event)
    })

    const unsubReconnect = onConnect(() => {
      void runSnapshot(sessionId, runningRef.current ? "resubscribe" : "bootstrap")
      runningRef.current = true
    })

    return () => {
      unsubEvents()
      unsubReconnect()
    }
  }, [sessionId, subscribe, onConnect])

  // Gap recovery: if an event classified as "recover" set pendingReplay,
  // run another snapshot. pendingReplay is cleared by completeSnapshot, so
  // this effect is idempotent.
  useEffect(() => {
    if (!sessionId) return
    const rec = slice?.recovery
    if (!rec?.pendingReplay || rec.inFlight) return
    void runSnapshot(sessionId, "sequence-gap")
  }, [sessionId, slice?.recovery.pendingReplay, slice?.recovery.inFlight])

  return slice
}
