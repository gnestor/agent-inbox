// Per-session transport hook.
//
// Responsibilities, in exactly this order:
//   1. On every WS (re)open, run a snapshot — full REST refetch of the session.
//      This covers the initial load and every reconnect, without any race
//      between fetch and subscribe.
//   2. Subscribe to WS events; route each through the store's coordinator.
//   3. Whenever the coordinator sets `pendingReplay` mid-stream (gap detected),
//      trigger another snapshot.
//
// All state ownership is in the session store. This hook is pure orchestration —
// no useState, no setState outside the store.

import { useEffect, useRef } from "react"
import { getSession } from "@/api/client"
import { useWsStream } from "@/hooks/use-ws-stream"
import {
  useSessionStore,
  type SessionSlice,
} from "@/stores/session-store"
import type { SessionRecoveryReason } from "@/stores/session-recovery"

export function useSessionTranscript(
  sessionId: string | undefined,
): SessionSlice | undefined {
  const slice = useSessionStore((s) => (sessionId ? s.sessions[sessionId] : undefined))
  const { subscribe, onConnect } = useWsStream()

  // Stable refs so our mount-effect's dependency array can stay minimal.
  const runningRef = useRef(false)

  useEffect(() => {
    if (!sessionId) return
    let alive = true

    const store = useSessionStore.getState()

    const runSnapshot = async (reason: SessionRecoveryReason) => {
      if (!alive) return
      if (!store.beginSnapshot(sessionId, reason)) return
      try {
        const data = await getSession(sessionId)
        if (!alive) return
        store.applySnapshot(sessionId, data)
      } catch (err) {
        if (!alive) return
        console.error("[session] snapshot fetch failed", { sessionId, err })
        store.failSnapshot(sessionId)
      }
    }

    // Subscribe to live events — events arriving before the first snapshot
    // completes will be classified as "defer" and buffered.
    const unsubEvents = subscribe(sessionId, (event) => {
      useSessionStore.getState().ingestEvent(sessionId, event)
    })

    // Every WS (re)open triggers a snapshot. Covers initial mount (onConnect
    // fires on next microtask if already connected) and every reconnection.
    const unsubReconnect = onConnect(() => {
      void runSnapshot(runningRef.current ? "resubscribe" : "bootstrap")
      runningRef.current = true
    })

    return () => {
      alive = false
      unsubEvents()
      unsubReconnect()
    }
  }, [sessionId, subscribe, onConnect])

  // Reactive: if an event classified as "recover" (gap detected) landed mid-
  // stream, trigger a snapshot. pendingReplay is cleared by completeSnapshot,
  // so this effect is idempotent.
  useEffect(() => {
    if (!sessionId) return
    const rec = slice?.recovery
    if (!rec?.pendingReplay || rec.inFlight) return
    const store = useSessionStore.getState()
    let alive = true
    ;(async () => {
      if (!store.beginSnapshot(sessionId, "sequence-gap")) return
      try {
        const data = await getSession(sessionId)
        if (!alive) return
        store.applySnapshot(sessionId, data)
      } catch (err) {
        if (!alive) return
        console.error("[session] gap-triggered snapshot failed", { sessionId, err })
        store.failSnapshot(sessionId)
      }
    })()
    return () => {
      alive = false
    }
  }, [sessionId, slice?.recovery.pendingReplay, slice?.recovery.inFlight])

  return slice
}
