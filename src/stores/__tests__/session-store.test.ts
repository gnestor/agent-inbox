// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest"
import { useSessionStore, MAX_DEFERRED_EVENTS } from "../session-store"
import type { Session, SessionMessage } from "@/types"

function makeSession(id = "s1", overrides: Partial<Session> = {}): Session {
  return {
    id,
    status: "running",
    prompt: "hi",
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

function makeMsg(sequence: number, type: string, content: unknown = ""): SessionMessage {
  return {
    id: sequence,
    sessionId: "s1",
    sequence,
    type,
    message: type === "user"
      ? { type: "user", content: content as string } as any
      : { type: "assistant", content: content as any[] } as any,
    createdAt: "2026-04-22T00:00:00Z",
  }
}

beforeEach(() => {
  const s = useSessionStore.getState()
  for (const id of Object.keys(s.sessions)) s.removeSession(id)
})

describe("session store — bootstrap flow", () => {
  it("events received before bootstrap are deferred and applied after snapshot", () => {
    const store = useSessionStore.getState()
    // Subscribe (implicit in real flow); ingest an event before any snapshot.
    // This should be classified as "defer" and buffered.
    store.ingestEvent("s1", {
      sequence: 1,
      message: { type: "assistant", content: [{ type: "text", text: "live" }] },
    })
    expect(useSessionStore.getState().sessions["s1"]?.deferredEvents).toHaveLength(1)
    expect(useSessionStore.getState().sessions["s1"]?.messageIds).toEqual([])

    // Begin + apply snapshot. Snapshot has only sequence 0 (initial prompt).
    expect(store.beginSnapshot("s1", "bootstrap")).toBe(true)
    store.applySnapshot("s1", {
      session: makeSession(),
      messages: [makeMsg(0, "user", "hi")],
    })
    const slice = useSessionStore.getState().sessions["s1"]!
    // Deferred event was flushed: sequence 1 is now applied.
    expect(slice.messageIds).toEqual([0, 1])
    expect(slice.deferredEvents).toHaveLength(0)
    expect(slice.recovery.bootstrapped).toBe(true)
  })

  it("snapshot that already contains deferred sequences just dedupes them", () => {
    const store = useSessionStore.getState()
    store.ingestEvent("s2", {
      sequence: 1,
      message: { type: "assistant", content: [] },
    })
    store.beginSnapshot("s2", "bootstrap")
    store.applySnapshot("s2", {
      session: makeSession("s2"),
      messages: [makeMsg(0, "user"), makeMsg(1, "assistant")],
    })
    const slice = useSessionStore.getState().sessions["s2"]!
    expect(slice.messageIds).toEqual([0, 1])
    expect(slice.deferredEvents).toHaveLength(0)
  })
})

describe("session store — live flow after bootstrap", () => {
  it("applies in-order events immediately", () => {
    const store = useSessionStore.getState()
    store.beginSnapshot("s3", "bootstrap")
    store.applySnapshot("s3", {
      session: makeSession("s3"),
      messages: [makeMsg(0, "user")],
    })
    store.ingestEvent("s3", {
      sequence: 1,
      message: { type: "assistant", content: [] },
    })
    const slice = useSessionStore.getState().sessions["s3"]!
    expect(slice.messageIds).toEqual([0, 1])
    expect(slice.recovery.latestSequence).toBe(1)
  })

  it("gap-detected event is deferred and pendingReplay is set", () => {
    const store = useSessionStore.getState()
    store.beginSnapshot("s4", "bootstrap")
    store.applySnapshot("s4", {
      session: makeSession("s4"),
      messages: [makeMsg(0, "user"), makeMsg(1, "assistant")],
    })
    // Jump to 5
    store.ingestEvent("s4", {
      sequence: 5,
      message: { type: "assistant", content: [] },
    })
    const slice = useSessionStore.getState().sessions["s4"]!
    expect(slice.messageIds).toEqual([0, 1]) // 5 is buffered, not applied
    expect(slice.deferredEvents).toHaveLength(1)
    expect(slice.recovery.pendingReplay).toBe(true)
  })

  it("duplicate events are ignored and leave state unchanged", () => {
    const store = useSessionStore.getState()
    store.beginSnapshot("s5", "bootstrap")
    store.applySnapshot("s5", {
      session: makeSession("s5"),
      messages: [makeMsg(0, "user"), makeMsg(1, "assistant")],
    })
    const before = useSessionStore.getState().sessions["s5"]!.messageById
    store.ingestEvent("s5", {
      sequence: 1,
      message: { type: "assistant", content: [{ type: "text", text: "dup" }] },
    })
    const after = useSessionStore.getState().sessions["s5"]!.messageById
    expect(after[1]).toBe(before[1]) // literally same reference
  })

  it("session_complete updates status via lifecycle branch", () => {
    const store = useSessionStore.getState()
    store.beginSnapshot("s6", "bootstrap")
    store.applySnapshot("s6", {
      session: makeSession("s6", { status: "running" }),
      messages: [],
    })
    store.ingestEvent("s6", { type: "session_complete" })
    expect(useSessionStore.getState().sessions["s6"]?.session.status).toBe("complete")
  })
})

describe("session store — optimistic prompts", () => {
  it("submits and auto-clears when the server echoes a matching user message", () => {
    const store = useSessionStore.getState()
    store.beginSnapshot("s7", "bootstrap")
    store.applySnapshot("s7", {
      session: makeSession("s7"),
      messages: [makeMsg(0, "user", "first prompt")],
    })
    const id = store.submitOptimisticPrompt("s7", "do the thing")
    expect(id).toBeTruthy()
    expect(useSessionStore.getState().sessions["s7"]!.pendingPrompts).toHaveLength(1)
    expect(useSessionStore.getState().sessions["s7"]!.session.status).toBe("running")

    // Server echoes the prompt as a real user message.
    store.ingestEvent("s7", {
      sequence: 1,
      message: { type: "user", content: "do the thing" },
    })
    const slice = useSessionStore.getState().sessions["s7"]!
    expect(slice.pendingPrompts).toHaveLength(0)
    expect(slice.messageIds).toEqual([0, 1])
  })
})

describe("session store — recovery lifecycle", () => {
  it("beginSnapshot while one is in flight returns false", () => {
    const store = useSessionStore.getState()
    expect(store.beginSnapshot("s8", "bootstrap")).toBe(true)
    expect(store.beginSnapshot("s8", "sequence-gap")).toBe(false)
  })

  it("failSnapshot clears inFlight so caller can retry", () => {
    const store = useSessionStore.getState()
    store.beginSnapshot("s9", "bootstrap")
    store.failSnapshot("s9")
    expect(store.beginSnapshot("s9", "snapshot-failed")).toBe(true)
  })

  it("Scenario: REST snapshot carries an explicit latestSequence cursor — server-supplied latestSequence advances the cursor past sparse message sequences", () => {
    // Regression: the JSONL transcript can have sparse `sequence` values
    // (skipped system/summary lines, thinking-block fractional offsets,
    // subagent renumbering) so messageIds[last] lags behind the live
    // broadcaster's counter, which starts at jsonlLines.length on resume.
    // Without this fix every WS event after resume classified as "recover"
    // and triggered a snapshot-fetch storm.
    const store = useSessionStore.getState()
    store.beginSnapshot("s-sparse", "bootstrap")
    store.applySnapshot("s-sparse", {
      session: makeSession("s-sparse"),
      // messages with sparse sequences — last visible is 5
      messages: [makeMsg(0, "user"), makeMsg(2, "assistant"), makeMsg(5, "assistant")],
      // server says jsonl is 10 lines long → next live event will be seq 10
      latestSequence: 9,
    })
    // Live event arrives at seq 10 — must classify as "apply", not "recover"
    store.ingestEvent("s-sparse", {
      sequence: 10,
      message: { type: "assistant", content: [] },
    })
    const slice = useSessionStore.getState().sessions["s-sparse"]!
    expect(slice.recovery.pendingReplay).toBe(false)
    expect(slice.recovery.latestSequence).toBe(10)
    expect(slice.messageIds).toContain(10)
  })

  it("Scenario: Bursts of events commit as one store transition — ingestEventBatch coalesces N events into one store notification", () => {
    const store = useSessionStore.getState()
    store.beginSnapshot("s-batch", "bootstrap")
    store.applySnapshot("s-batch", {
      session: makeSession("s-batch"),
      messages: [],
      latestSequence: 0,
    })

    let notifyCount = 0
    const unsub = useSessionStore.subscribe(() => { notifyCount++ })

    // 500 consecutive events — the exact pattern that floods React under
    // broadcast-buffer replay. Without batching this would fire 500 sets;
    // with batching it should fire one.
    const events = Array.from({ length: 500 }, (_, i) => ({
      sequence: i + 1,
      message: { type: "assistant", content: [] },
    }))
    useSessionStore.getState().ingestEventBatch("s-batch", events)

    unsub()
    expect(notifyCount).toBe(1)
    const slice = useSessionStore.getState().sessions["s-batch"]!
    expect(slice.messageIds).toHaveLength(500)
    expect(slice.recovery.latestSequence).toBe(500)
  })

  it("Scenario: All-ignore batches skip the slice mutation — ingestEventBatch with all-ignore events does not allocate a new slice", () => {
    const store = useSessionStore.getState()
    store.beginSnapshot("s-dup", "bootstrap")
    store.applySnapshot("s-dup", {
      session: makeSession("s-dup"),
      messages: [makeMsg(1, "user")],
      latestSequence: 1,
    })
    const sliceBefore = useSessionStore.getState().sessions["s-dup"]!

    // Re-ingest sequence 1 (already applied) ten times — every event is "ignore".
    const events = Array.from({ length: 10 }, () => ({
      sequence: 1,
      message: { type: "user", content: "dup" },
    }))
    useSessionStore.getState().ingestEventBatch("s-dup", events)

    const sliceAfter = useSessionStore.getState().sessions["s-dup"]!
    // Recovery state may have new highestObserved bump, but no message data changed.
    expect(sliceAfter.messageIds).toEqual(sliceBefore.messageIds)
    expect(sliceAfter.messageById).toEqual(sliceBefore.messageById)
  })

  it("Scenario: Open breaker drops deferred events during applySnapshot — once the circuit is open, applySnapshot skips the flush loop and sets deferredEvents to []", () => {
    const store = useSessionStore.getState()
    // Bootstrap with a non-zero baseline so gap detection arms.
    store.beginSnapshot("s-breaker", "bootstrap")
    store.applySnapshot("s-breaker", {
      session: makeSession("s-breaker"),
      messages: [makeMsg(0, "user")],
      latestSequence: 1000,
    })
    // Broadcaster is way ahead; snapshot endpoint can only ever return 1000.
    // Repeat the unsatisfied-gap round until the breaker trips.
    for (let i = 0; i < 4; i++) {
      store.ingestEvent("s-breaker", {
        sequence: 1500,
        message: { type: "assistant", content: [] },
      })
      store.beginSnapshot("s-breaker", "sequence-gap")
      store.applySnapshot("s-breaker", {
        session: makeSession("s-breaker"),
        messages: [makeMsg(0, "user")],
        latestSequence: 1000,
      })
    }
    const slice = useSessionStore.getState().sessions["s-breaker"]!
    // The flush loop was skipped: no deferred events survive an open breaker.
    expect(slice.deferredEvents).toEqual([])
  })

  it("Scenario: Deferred buffer caps at MAX_DEFERRED_EVENTS — deferredEvents is bounded at MAX_DEFERRED_EVENTS; oldest drops on overflow", () => {
    const store = useSessionStore.getState()
    // No bootstrap — all message events get deferred.
    for (let i = 1; i <= MAX_DEFERRED_EVENTS + 10; i++) {
      store.ingestEvent("s-cap", {
        sequence: i,
        message: { type: "assistant", content: [] },
      })
    }
    const slice = useSessionStore.getState().sessions["s-cap"]!
    expect(slice.deferredEvents).toHaveLength(MAX_DEFERRED_EVENTS)
    // The oldest surviving event should be sequence 11 (first 10 dropped).
    const firstSeq = (slice.deferredEvents[0] as { sequence: number }).sequence
    expect(firstSeq).toBe(11)
    // pendingReplay is set (coordinator's signal that a snapshot is needed).
    expect(slice.recovery.pendingReplay).toBe(true)
  })
})
