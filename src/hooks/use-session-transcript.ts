import { useEffect, startTransition } from "react"
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
// because the store is independent of React's mount lifecycle.
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

  useEffect(() => {
    if (!sessionId) return

    const unsubEvents = subscribe(
      sessionId,
      (event) => { startTransition(() => useSessionStore.getState().ingestEvent(sessionId, event)) },
      {
        // Cursor: send the highest applied sequence so the server can replay
        // events we missed during any WS gap. Returns undefined on initial
        // bootstrap (no prior state), which tells the server "no replay —
        // fresh subscriber".
        getFromSequence: () => {
          const rec = useSessionStore.getState().sessions[sessionId]?.recovery
          return rec && rec.latestSequence > 0 ? rec.latestSequence : undefined
        },
        // Server can't replay because our cursor fell outside the buffer
        // window. Roll bootstrapped back so the gap-recovery effect runs
        // a fresh snapshot.
        onCursorMiss: () => {
          useSessionStore.getState().handleCursorMiss(sessionId)
        },
      },
    )

    // Initial bootstrap on (first) connect — subsequent reconnects are handled
    // by the cursor-based replay on the server, so we no longer fire a
    // snapshot on every reconnect.
    const unsubConnect = onConnect(() => {
      const rec = useSessionStore.getState().sessions[sessionId]?.recovery
      if (!rec?.bootstrapped) {
        void runSnapshot(sessionId, "bootstrap")
      }
    })

    return () => {
      unsubEvents()
      unsubConnect()
    }
  }, [sessionId, subscribe, onConnect])

  // Gap recovery: if an event classified as "recover" or cursor_miss set
  // pendingReplay, run a snapshot. pendingReplay is cleared by
  // completeSnapshot/failSnapshot so this effect is idempotent.
  useEffect(() => {
    if (!sessionId) return
    const rec = slice?.recovery
    if (!rec?.pendingReplay || rec.inFlight) return
    void runSnapshot(sessionId, rec.bootstrapped ? "sequence-gap" : "cursor-miss")
  }, [sessionId, slice?.recovery.pendingReplay, slice?.recovery.inFlight, slice?.recovery.bootstrapped])

  return slice
}
