// Per-session recovery coordinator — pure state machine.
//
// Ported from pingdotgg/t3code's orchestrationRecovery.ts, specialised for
// sessions. Every incoming WS event is classified before anything touches the
// transcript store. Snapshot (full REST refetch) is the only catch-up
// primitive; there is no replay endpoint.
//
// Classifications:
//   "ignore"  — sequence has already been applied (dedup)
//   "defer"   — not bootstrapped yet, or a snapshot is in flight; buffer the event
//   "recover" — sequence is ahead of what we expect; request a snapshot
//   "apply"   — sequence is exactly latestSequence + 1; reduce into store now
//
// The coordinator is a plain factory — no React, no store bindings — so it is
// trivially unit-testable.

export type SessionRecoveryReason =
  | "bootstrap"
  | "sequence-gap"
  | "resubscribe"
  | "snapshot-failed"
  | "cursor-miss"

export interface SessionRecoveryPhase {
  readonly kind: "snapshot"
  readonly reason: SessionRecoveryReason
}

export interface SessionRecoveryState {
  readonly latestSequence: number
  readonly highestObservedSequence: number
  readonly bootstrapped: boolean
  readonly pendingReplay: boolean
  readonly inFlight: SessionRecoveryPhase | null
}

export type EventClassification = "ignore" | "defer" | "recover" | "apply"

export interface SessionRecoveryCoordinator {
  getState(): SessionRecoveryState
  /** Classify an inbound event; mutates internal state (observes seq, sets pendingReplay on gap). */
  classifyEvent(sequence: number): EventClassification
  /** Mark a batch of apply'd events; advances latestSequence. Returns the filtered-sorted batch. */
  markEventBatchApplied<T extends { sequence: number }>(events: readonly T[]): readonly T[]
  /** Begin a snapshot. Returns false if one is already in flight (caller should skip). */
  beginSnapshotRecovery(reason: SessionRecoveryReason): boolean
  /** Complete a snapshot — returns true if a follow-up is needed (more events arrived mid-flight). */
  completeSnapshotRecovery(snapshotSequence: number): boolean
  failSnapshotRecovery(): void
  /** Force a return to bootstrap state — the server told us our cursor is no
   *  longer replayable. The gap effect will then run a fresh snapshot. */
  invalidateBootstrap(): void
  /** True iff the coordinator's circuit breaker has tripped — the caller
   *  should drop any deferred events buffered for this session, since
   *  snapshot recovery is not converging. Auto-clears on the next successful
   *  apply or after `invalidateBootstrap`. */
  isCircuitOpen(): boolean
}

/**
 * If a snapshot completes without closing the gap (highestObservedSequence
 * still ahead of latestSequence) this many times in a row, we declare the
 * snapshot endpoint unable to satisfy the broadcaster — likely the
 * broadcaster is emitting sequence numbers ahead of what the snapshot source
 * stores. We give up the chase so the React layer doesn't re-fire snapshots
 * forever, blowing the heap. The breaker auto-resets on the next event we
 * actually apply (`markEventBatchApplied`) or on `invalidateBootstrap`.
 */
export const MAX_CONSECUTIVE_UNSATISFIED_SNAPSHOTS = 3

export function createSessionRecoveryCoordinator(): SessionRecoveryCoordinator {
  let state: SessionRecoveryState = {
    latestSequence: 0,
    highestObservedSequence: 0,
    bootstrapped: false,
    pendingReplay: false,
    inFlight: null,
  }

  // Circuit-breaker counter: incremented on each completeSnapshotRecovery
  // that doesn't close the observed-ahead gap; reset by markEventBatchApplied
  // or invalidateBootstrap. When >= MAX_CONSECUTIVE_UNSATISFIED_SNAPSHOTS we
  // stop setting pendingReplay so the React effect doesn't re-fire.
  let unsatisfiedSnapshotCount = 0

  const snapshot = (): SessionRecoveryState => ({ ...state })

  const observeSequence = (sequence: number) => {
    if (sequence > state.highestObservedSequence) {
      state = { ...state, highestObservedSequence: sequence }
    }
  }

  const circuitOpen = () => unsatisfiedSnapshotCount >= MAX_CONSECUTIVE_UNSATISFIED_SNAPSHOTS

  const resolveReplayNeed = () => {
    // We only have snapshot recovery. A follow-up is needed iff the highest
    // observed sequence exceeds what we've now applied — i.e. events arrived
    // during the snapshot that the snapshot didn't cover.
    const observedAhead = state.highestObservedSequence > state.latestSequence
    if (observedAhead) {
      unsatisfiedSnapshotCount++
      if (circuitOpen()) {
        // Pin highestObserved to latest so the React effect doesn't re-fire.
        // A future event with a satisfiable sequence re-triggers the chase
        // from a fresh counter. Guard the allocation: this path is exactly
        // the no-op churn the breaker exists to stop.
        if (state.pendingReplay || state.highestObservedSequence !== state.latestSequence) {
          state = {
            ...state,
            highestObservedSequence: state.latestSequence,
            pendingReplay: false,
          }
        }
        return false
      }
    } else {
      unsatisfiedSnapshotCount = 0
    }
    if (state.pendingReplay) {
      state = { ...state, pendingReplay: false }
    }
    return observedAhead
  }

  return {
    getState: snapshot,

    classifyEvent(sequence) {
      observeSequence(sequence)

      if (sequence <= state.latestSequence) return "ignore"

      if (!state.bootstrapped || state.inFlight) {
        state = { ...state, pendingReplay: true }
        return "defer"
      }

      // Gap: received sequence is not the next expected. Note: for the initial
      // bootstrap case, latestSequence === 0 and the first real event may be
      // sequence 0 (initial user prompt) or 1 (first assistant message) — both
      // legitimate. We only flag a gap when latestSequence > 0.
      if (state.latestSequence > 0 && sequence !== state.latestSequence + 1) {
        state = { ...state, pendingReplay: true }
        return "recover"
      }

      return "apply"
    },

    markEventBatchApplied(events) {
      const advanced = events
        .filter((e) => e.sequence > state.latestSequence)
        .slice()
        .sort((a, b) => a.sequence - b.sequence)
      if (advanced.length === 0) return []
      const newLatest = advanced[advanced.length - 1]!.sequence
      state = {
        ...state,
        latestSequence: newLatest,
        highestObservedSequence: Math.max(state.highestObservedSequence, newLatest),
      }
      // Any successful apply means we're making real progress; clear the breaker.
      unsatisfiedSnapshotCount = 0
      return advanced
    },

    beginSnapshotRecovery(reason) {
      if (state.inFlight) {
        state = { ...state, pendingReplay: true }
        return false
      }
      state = { ...state, inFlight: { kind: "snapshot", reason } }
      return true
    },

    completeSnapshotRecovery(snapshotSequence) {
      state = {
        ...state,
        latestSequence: Math.max(state.latestSequence, snapshotSequence),
        highestObservedSequence: Math.max(state.highestObservedSequence, snapshotSequence),
        bootstrapped: true,
        inFlight: null,
      }
      return resolveReplayNeed()
    },

    failSnapshotRecovery() {
      // Clear pendingReplay too: otherwise the caller's effect would re-fire
      // immediately because the condition `pendingReplay && !inFlight` is
      // still true, producing an infinite retry loop on a persistent failure
      // (network down, server 500s, etc). If there's still a real gap, the
      // next classifyEvent will re-set pendingReplay and the effect fires
      // once more. If the failure is permanent, the client falls back to
      // whatever it has and the next WS reconnect triggers a fresh snapshot.
      state = { ...state, inFlight: null, pendingReplay: false }
    },

    invalidateBootstrap() {
      // Server replied with cursor_miss — our replay window is gone. Roll the
      // state machine back to pre-bootstrap + pendingReplay so the existing
      // gap effect runs a snapshot. Preserve observed sequence and current
      // latest so dedup still works against in-flight events.
      state = { ...state, bootstrapped: false, pendingReplay: true, inFlight: null }
      // Fresh recovery attempt — reset the breaker so cursor_miss after a
      // long-quiet session doesn't immediately fall into the giving-up path.
      unsatisfiedSnapshotCount = 0
    },

    isCircuitOpen() {
      return circuitOpen()
    },
  }
}
