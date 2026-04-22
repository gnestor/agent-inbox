// Session transcript store — single source of truth for all live session state.
//
// State is normalised per-sessionId. All writes go through actions that route
// through the per-session recovery coordinator before touching the slice. The
// coordinator classifies each inbound event (ignore / defer / recover / apply)
// so nothing accidentally mutates the transcript out of order.
//
// This replaces the scattered state that previously lived across:
//   - React Query cache for ["session", id]
//   - useState in use-session-stream (sessionStatus, pendingQuestion, presence)
//   - qc.setQueryData calls from REST fetch, WS events, and optimistic resume

import { create } from "zustand"

import type { Session, SessionMessage } from "@/types"
import {
  createSessionRecoveryCoordinator,
  type SessionRecoveryCoordinator,
  type SessionRecoveryReason,
  type SessionRecoveryState,
} from "./session-recovery"
import {
  reduceSnapshot,
  reduceEvent,
  reduceOptimisticPrompt,
  reduceClearPendingQuestion,
  isMessageEvent,
  type ServerEvent,
  type SessionSlice as BaseSessionSlice,
} from "./session-reducer"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionSlice extends BaseSessionSlice {
  /** Snapshot of the coordinator state. Rendered by the UI to drive spinners etc. */
  recovery: SessionRecoveryState
  /** Events received during bootstrap / in-flight recovery. Flushed on completion. */
  deferredEvents: ServerEvent[]
}

export interface SnapshotPayload {
  session: Session
  messages: SessionMessage[]
}

interface SessionStoreState {
  sessions: Record<string, SessionSlice>
  // Coordinators are stored outside of `sessions` so they aren't serialized
  // into the selector-visible state tree. They're mutable state machines, not
  // plain data; exposing them would invite misuse.
  _coordinators: Record<string, SessionRecoveryCoordinator>

  /** Ingest a WS event, routing it through the coordinator. */
  ingestEvent(sessionId: string, event: ServerEvent): void
  /** Apply a REST snapshot. Fails gracefully if no coordinator exists for the session yet. */
  applySnapshot(sessionId: string, snapshot: SnapshotPayload): void
  /** Attempt to begin a snapshot. Returns true if the caller should actually fetch. */
  beginSnapshot(sessionId: string, reason: SessionRecoveryReason): boolean
  /** Mark a snapshot as failed so the caller can retry. */
  failSnapshot(sessionId: string): void
  /** Record an optimistic user prompt. Returns the localId used. */
  submitOptimisticPrompt(sessionId: string, prompt: string): string
  /** Clear the pending question after the user answers. */
  clearPendingQuestion(sessionId: string): void
  /** Drop a session slice from memory (e.g. when navigating away and it's no longer needed). */
  removeSession(sessionId: string): void
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

function emptyRecoveryState(): SessionRecoveryState {
  return {
    latestSequence: 0,
    highestObservedSequence: 0,
    bootstrapped: false,
    pendingReplay: false,
    inFlight: null,
  }
}

function ensureCoordinator(
  state: SessionStoreState,
  sessionId: string,
): [SessionStoreState, SessionRecoveryCoordinator] {
  const existing = state._coordinators[sessionId]
  if (existing) return [state, existing]
  const c = createSessionRecoveryCoordinator()
  return [
    { ...state, _coordinators: { ...state._coordinators, [sessionId]: c } },
    c,
  ]
}

export const useSessionStore = create<SessionStoreState>((set, get) => ({
  sessions: {},
  _coordinators: {},

  ingestEvent: (sessionId, event) => {
    const [s0, coord] = ensureCoordinator(get(), sessionId)
    // If this is a message event the coordinator decides routing. Lifecycle
    // events (status, ask_user_question, presence) are not sequenced and
    // always apply directly.
    if (isMessageEvent(event)) {
      const classification = coord.classifyEvent(event.sequence)
      if (classification === "ignore") {
        // Still persist the updated coordinator state snapshot into the slice
        // so selectors see the newly-observed sequence.
        syncRecoveryState(s0, sessionId, coord, set)
        return
      }

      if (classification === "defer" || classification === "recover") {
        // Buffer the event. It will be replayed by applySnapshot's flush.
        const slice = ensureSlice(s0, sessionId)
        set({
          ...s0,
          sessions: {
            ...s0.sessions,
            [sessionId]: {
              ...slice,
              deferredEvents: [...slice.deferredEvents, event],
              recovery: coord.getState(),
            },
          },
        })
        return
      }

      // classification === "apply"
      const slice = ensureSlice(s0, sessionId)
      const nextSlice = reduceEvent(slice, event)
      coord.markEventBatchApplied([event])
      set({
        ...s0,
        sessions: {
          ...s0.sessions,
          [sessionId]: {
            ...nextSlice,
            recovery: coord.getState(),
            deferredEvents: slice.deferredEvents,
          },
        },
      })
      return
    }

    // Lifecycle event — always apply.
    const slice = ensureSlice(s0, sessionId)
    set({
      ...s0,
      sessions: {
        ...s0.sessions,
        [sessionId]: {
          ...reduceEvent(slice, event),
          recovery: coord.getState(),
          deferredEvents: slice.deferredEvents,
        },
      },
    })
  },

  applySnapshot: (sessionId, snapshot) => {
    const [s0, coord] = ensureCoordinator(get(), sessionId)
    const prevSlice = s0.sessions[sessionId]
    const baseNext = reduceSnapshot(prevSlice, snapshot)

    // Highest sequence in the snapshot.
    const snapshotHigh = baseNext.messageIds.length > 0
      ? baseNext.messageIds[baseNext.messageIds.length - 1]!
      : 0
    coord.completeSnapshotRecovery(snapshotHigh)

    // Flush any deferred events through reduceEvent. Events whose sequence is
    // <= latestSequence are filtered out cheaply by the seen-sequence check
    // in reduceEvent; events beyond will apply.
    const deferred = prevSlice?.deferredEvents ?? []
    let workingSlice: SessionSlice = {
      ...baseNext,
      recovery: coord.getState(),
      deferredEvents: [],
    }
    for (const ev of deferred) {
      if (isMessageEvent(ev)) {
        const classification = coord.classifyEvent(ev.sequence)
        if (classification === "apply") {
          workingSlice = { ...reduceEvent(workingSlice, ev), recovery: workingSlice.recovery, deferredEvents: workingSlice.deferredEvents }
          coord.markEventBatchApplied([ev])
        } else if (classification === "recover" || classification === "defer") {
          // Still a gap — hold this event for the next snapshot round.
          workingSlice = {
            ...workingSlice,
            deferredEvents: [...workingSlice.deferredEvents, ev],
          }
        }
        // "ignore" — drop silently
      } else {
        workingSlice = {
          ...reduceEvent(workingSlice, ev),
          recovery: workingSlice.recovery,
          deferredEvents: workingSlice.deferredEvents,
        }
      }
    }
    workingSlice = { ...workingSlice, recovery: coord.getState() }

    set({
      ...s0,
      sessions: { ...s0.sessions, [sessionId]: workingSlice },
    })
  },

  beginSnapshot: (sessionId, reason) => {
    const [s0, coord] = ensureCoordinator(get(), sessionId)
    if (s0 !== get()) set(s0)
    const accepted = coord.beginSnapshotRecovery(reason)
    syncRecoveryState(get(), sessionId, coord, set)
    return accepted
  },

  failSnapshot: (sessionId) => {
    const coord = get()._coordinators[sessionId]
    if (!coord) return
    coord.failSnapshotRecovery()
    syncRecoveryState(get(), sessionId, coord, set)
  },

  submitOptimisticPrompt: (sessionId, prompt) => {
    const localId = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const s0 = get()
    const slice = s0.sessions[sessionId]
    if (!slice) return localId // no-op if we don't yet have a slice
    const reduced = reduceOptimisticPrompt(slice, prompt, localId)
    set({
      ...s0,
      sessions: {
        ...s0.sessions,
        [sessionId]: { ...reduced, recovery: slice.recovery, deferredEvents: slice.deferredEvents },
      },
    })
    return localId
  },

  clearPendingQuestion: (sessionId) => {
    const s0 = get()
    const slice = s0.sessions[sessionId]
    if (!slice) return
    const reduced = reduceClearPendingQuestion(slice)
    set({
      ...s0,
      sessions: {
        ...s0.sessions,
        [sessionId]: { ...reduced, recovery: slice.recovery, deferredEvents: slice.deferredEvents },
      },
    })
  },

  removeSession: (sessionId) => {
    const { sessions, _coordinators, ...rest } = get()
    const nextSessions = { ...sessions }
    const nextCoords = { ..._coordinators }
    delete nextSessions[sessionId]
    delete nextCoords[sessionId]
    set({ ...rest, sessions: nextSessions, _coordinators: nextCoords })
  },
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureSlice(state: SessionStoreState, sessionId: string): SessionSlice {
  const existing = state.sessions[sessionId]
  if (existing) return existing
  // Placeholder: used when an event arrives before we've ever seen a snapshot.
  // The session metadata is intentionally minimal; applySnapshot will replace it.
  return {
    session: {
      id: sessionId,
      status: "running",
      prompt: "",
      summary: null,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
      linkedSourceType: null,
      linkedSourceId: null,
      triggerSource: "manual",
      project: "",
      linkedItemTitle: null,
    },
    messageIds: [],
    messageById: {},
    pendingPrompts: [],
    pendingQuestion: null,
    presence: [],
    recovery: emptyRecoveryState(),
    deferredEvents: [],
  }
}

function syncRecoveryState(
  state: SessionStoreState,
  sessionId: string,
  coord: SessionRecoveryCoordinator,
  setFn: (partial: Partial<SessionStoreState> | SessionStoreState) => void,
) {
  const slice = state.sessions[sessionId]
  if (!slice) {
    // Coordinator is tracking events for a session we don't have a slice for
    // yet. That's fine; the slice will be created by applySnapshot, and the
    // coordinator will be read then.
    return
  }
  setFn({
    ...state,
    sessions: {
      ...state.sessions,
      [sessionId]: { ...slice, recovery: coord.getState() },
    },
  })
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export const selectSession = (sessionId: string) =>
  (s: SessionStoreState): SessionSlice | undefined => s.sessions[sessionId]

export const selectIsReady = (sessionId: string) =>
  (s: SessionStoreState): boolean => !!s.sessions[sessionId]?.recovery.bootstrapped
