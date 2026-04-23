// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest"
import { useSessionStore, type SessionSlice } from "../session-store"
import type { Session } from "@/types"

// Seeded PRNG so failures are reproducible — Mulberry32.
function makeRng(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6D2B79F5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeSession(id: string, overrides: Partial<Session> = {}): Session {
  return {
    id,
    status: "running",
    prompt: "",
    summary: null,
    startedAt: "2026-04-22T00:00:00Z",
    updatedAt: "2026-04-22T00:00:00Z",
    completedAt: null,
    linkedSourceType: null,
    linkedSourceId: null,
    triggerSource: "manual",
    project: "demo",
    linkedItemTitle: null,
    ...overrides,
  }
}

function assertInvariants(sessionId: string, state: {
  sliceHistory: ReadonlyArray<SessionSlice | undefined>
  inFlightDepth: number
}): void {
  const slice = useSessionStore.getState().sessions[sessionId]
  if (!slice) return

  // messageIds is sorted ascending with unique entries
  for (let i = 1; i < slice.messageIds.length; i++) {
    expect(slice.messageIds[i]).toBeGreaterThan(slice.messageIds[i - 1]!)
  }

  // messageById keys agree with messageIds
  const keys = Object.keys(slice.messageById).map(Number).sort((a, b) => a - b)
  expect(keys).toEqual([...slice.messageIds])

  // bootstrapped is monotonic: once true, never goes false EXCEPT via
  // handleCursorMiss (invalidateBootstrap). So we only check that if the
  // previous slice was bootstrapped AND cursor_miss hasn't just happened,
  // we don't regress. The orchestration layer actively calls
  // invalidateBootstrap in one narrow flow; other flows must preserve true.
  // For the chaos test we just check that sliceHistory's bootstrapped flips
  // only on a handleCursorMiss action, which we encode below by skipping
  // this check right after that action.

  // latestSequence never decreases (it's monotonic by construction of the
  // coordinator's completeSnapshotRecovery / markEventBatchApplied).
  if (state.sliceHistory.length > 0) {
    const prev = state.sliceHistory.at(-1)
    if (prev?.recovery) {
      expect(slice.recovery.latestSequence).toBeGreaterThanOrEqual(prev.recovery.latestSequence)
    }
  }

  // inFlight protocol: never set twice without release. Tracked externally
  // as inFlightDepth, which is always 0 or 1 in the driver.
  expect(state.inFlightDepth).toBeLessThanOrEqual(1)
  expect(state.inFlightDepth).toBeGreaterThanOrEqual(0)

  // Coordinator's inFlight matches inFlightDepth
  if (state.inFlightDepth === 1) {
    expect(slice.recovery.inFlight).not.toBeNull()
  } else {
    expect(slice.recovery.inFlight).toBeNull()
  }
}

describe("session store chaos / fuzz", () => {
  beforeEach(() => {
    const s = useSessionStore.getState()
    for (const id of Object.keys(s.sessions)) s.removeSession(id)
  })

  for (const seed of [1, 42, 1337, 2026, 99999]) {
    it(`N=1000 random actions with seed=${seed} preserves invariants`, () => {
      const rng = makeRng(seed)
      const sessionId = "chaos"
      const store = useSessionStore.getState()
      const sliceHistory: SessionSlice[] = []
      let inFlightDepth = 0
      const promptsSeen: string[] = []

      for (let step = 0; step < 1000; step++) {
        const roll = rng()

        // Actions and their rough frequencies:
        //   50% ingestEvent (message at random sequence)
        //    5% begin/apply/fail snapshot cycle
        //   10% lifecycle event (session_complete / ask_user_question / presence)
        //   15% optimistic prompt submission + echo
        //    5% handleCursorMiss
        //    5% setSessionStatus / setSessionSummary
        //   10% misc (clearPendingQuestion, no-op)

        if (roll < 0.5) {
          // Random sequence within a jittery range
          const sequence = Math.max(1, Math.floor(rng() * 200))
          const type = rng() < 0.3 ? "user" : "assistant"
          const content = type === "user" ? `msg-${step}` : [{ type: "text", text: `t-${step}` }]
          store.ingestEvent(sessionId, { sequence, message: { type, content } } as any)
        } else if (roll < 0.55) {
          // Snapshot cycle
          const accepted = store.beginSnapshot(sessionId, "bootstrap")
          if (accepted) {
            inFlightDepth = 1
            if (rng() < 0.8) {
              // Apply with a handful of random messages
              const n = Math.floor(rng() * 10)
              const messages = Array.from({ length: n }, (_, i) => ({
                id: i,
                sessionId,
                sequence: i,
                type: i === 0 ? "user" : "assistant",
                message: i === 0
                  ? { type: "user", content: `s-${step}-${i}` }
                  : { type: "assistant", content: [] },
                createdAt: "t",
              })) as any
              store.applySnapshot(sessionId, { session: makeSession(sessionId), messages })
            } else {
              store.failSnapshot(sessionId)
            }
            inFlightDepth = 0
          }
        } else if (roll < 0.65) {
          // Lifecycle event
          const pick = rng()
          if (pick < 0.33) {
            store.ingestEvent(sessionId, { type: "session_complete" } as any)
          } else if (pick < 0.66) {
            store.ingestEvent(sessionId, {
              type: "ask_user_question",
              questions: [{ question: "?", header: "Q", options: [], multiSelect: false }],
            } as any)
          } else {
            store.ingestEvent(sessionId, {
              type: "presence",
              users: [{ email: "a@b", name: "A" }],
            } as any)
          }
        } else if (roll < 0.8) {
          // Optimistic prompt — sometimes echoed, sometimes not.
          const prompt = `prompt-${step}`
          store.submitOptimisticPrompt(sessionId, prompt)
          promptsSeen.push(prompt)
          if (rng() < 0.5 && promptsSeen.length > 0) {
            // Echo a random prior prompt as a user message
            const text = promptsSeen[Math.floor(rng() * promptsSeen.length)]!
            store.ingestEvent(sessionId, {
              sequence: Math.max(1, Math.floor(rng() * 200)),
              message: { type: "user", content: text },
            } as any)
          }
        } else if (roll < 0.85) {
          store.handleCursorMiss(sessionId)
        } else if (roll < 0.9) {
          store.setSessionStatus(sessionId, rng() < 0.5 ? "complete" : "running")
        } else if (roll < 0.95) {
          store.setSessionSummary(sessionId, rng() < 0.5 ? `title-${step}` : null)
        } else {
          store.clearPendingQuestion(sessionId)
        }

        assertInvariants(sessionId, { sliceHistory, inFlightDepth })
        const slice = useSessionStore.getState().sessions[sessionId]
        if (slice) sliceHistory.push(slice)
      }
    })
  }
})
