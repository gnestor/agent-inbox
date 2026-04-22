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
}

export function createSessionRecoveryCoordinator(): SessionRecoveryCoordinator {
  let state: SessionRecoveryState = {
    latestSequence: 0,
    highestObservedSequence: 0,
    bootstrapped: false,
    pendingReplay: false,
    inFlight: null,
  }

  const snapshot = (): SessionRecoveryState => ({ ...state })

  const observeSequence = (sequence: number) => {
    if (sequence > state.highestObservedSequence) {
      state = { ...state, highestObservedSequence: sequence }
    }
  }

  const resolveReplayNeed = () => {
    // We only have snapshot recovery. A follow-up is needed iff the highest
    // observed sequence exceeds what we've now applied — i.e. events arrived
    // during the snapshot that the snapshot didn't cover. `pendingReplay` is
    // cleared unconditionally; the gap signal is `highestObserved > latest`.
    const observedAhead = state.highestObservedSequence > state.latestSequence
    state = { ...state, pendingReplay: false }
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
      state = { ...state, inFlight: null }
    },
  }
}
