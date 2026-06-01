import { describe, it, expect } from "vitest"
import { createSessionRecoveryCoordinator, MAX_CONSECUTIVE_UNSATISFIED_SNAPSHOTS } from "../session-recovery"

describe("session-recovery coordinator", () => {
  it("defers events until bootstrap is complete", () => {
    const c = createSessionRecoveryCoordinator()
    expect(c.classifyEvent(1)).toBe("defer")
    expect(c.classifyEvent(2)).toBe("defer")
    expect(c.getState().highestObservedSequence).toBe(2)
    expect(c.getState().pendingReplay).toBe(true)
  })

  it("Scenario: Snapshot lifecycle follows begin → (complete | fail) — bootstrap completes and resolves pendingReplay when observed > latest", () => {
    const c = createSessionRecoveryCoordinator()
    c.classifyEvent(5) // defer, pendingReplay = true
    expect(c.beginSnapshotRecovery("bootstrap")).toBe(true)
    // Snapshot returns through sequence 3 (a lower seq than observed)
    const shouldReplay = c.completeSnapshotRecovery(3)
    expect(shouldReplay).toBe(true)
    expect(c.getState().bootstrapped).toBe(true)
    expect(c.getState().inFlight).toBeNull()
  })

  it("bootstrap with catching-up snapshot clears pendingReplay", () => {
    const c = createSessionRecoveryCoordinator()
    c.classifyEvent(3)
    c.beginSnapshotRecovery("bootstrap")
    const shouldReplay = c.completeSnapshotRecovery(3)
    expect(shouldReplay).toBe(false)
  })

  it("Scenario: Exact next-sequence event applies — applies events in strict monotonic order after bootstrap", () => {
    const c = createSessionRecoveryCoordinator()
    c.beginSnapshotRecovery("bootstrap")
    c.completeSnapshotRecovery(0)
    expect(c.classifyEvent(1)).toBe("apply")
    c.markEventBatchApplied([{ sequence: 1 }])
    expect(c.classifyEvent(2)).toBe("apply")
    c.markEventBatchApplied([{ sequence: 2 }])
    expect(c.getState().latestSequence).toBe(2)
  })

  it("Scenario: Duplicate event is ignored — ignores duplicate sequences", () => {
    const c = createSessionRecoveryCoordinator()
    c.beginSnapshotRecovery("bootstrap")
    c.completeSnapshotRecovery(5)
    expect(c.classifyEvent(3)).toBe("ignore")
    expect(c.classifyEvent(5)).toBe("ignore")
  })

  it("Scenario: Sequence gap triggers recovery — detects gaps and returns recover", () => {
    const c = createSessionRecoveryCoordinator()
    c.beginSnapshotRecovery("bootstrap")
    c.completeSnapshotRecovery(1)
    expect(c.classifyEvent(2)).toBe("apply")
    c.markEventBatchApplied([{ sequence: 2 }])
    // Jump to 5 — gap of 3, 4
    expect(c.classifyEvent(5)).toBe("recover")
    expect(c.getState().pendingReplay).toBe(true)
    expect(c.getState().highestObservedSequence).toBe(5)
  })

  it("Scenario: Event during snapshot-in-flight is deferred — defers events while snapshot is in flight", () => {
    const c = createSessionRecoveryCoordinator()
    c.beginSnapshotRecovery("bootstrap")
    expect(c.classifyEvent(7)).toBe("defer")
    expect(c.getState().pendingReplay).toBe(true)
    // New begin while one is in flight returns false and keeps pendingReplay
    expect(c.beginSnapshotRecovery("sequence-gap")).toBe(false)
    expect(c.getState().pendingReplay).toBe(true)
    c.completeSnapshotRecovery(0)
    // After completion the pendingReplay flag drove the return-value of completeSnapshotRecovery
  })

  it("markEventBatchApplied skips sequences <= latestSequence and advances monotonically", () => {
    const c = createSessionRecoveryCoordinator()
    c.beginSnapshotRecovery("bootstrap")
    c.completeSnapshotRecovery(3)
    const advanced = c.markEventBatchApplied([
      { sequence: 1 }, // already seen
      { sequence: 3 }, // already seen
      { sequence: 5 },
      { sequence: 4 }, // out of order — coordinator sorts
    ])
    expect(advanced.map((e) => e.sequence)).toEqual([4, 5])
    expect(c.getState().latestSequence).toBe(5)
  })

  it("Scenario: Failed snapshot does not retry indefinitely — failSnapshotRecovery clears inFlight so the caller can retry", () => {
    const c = createSessionRecoveryCoordinator()
    expect(c.beginSnapshotRecovery("bootstrap")).toBe(true)
    c.failSnapshotRecovery()
    expect(c.getState().inFlight).toBeNull()
    expect(c.beginSnapshotRecovery("snapshot-failed")).toBe(true)
  })

  it("first real event at bootstrap (latest=0) is not mis-flagged as a gap", () => {
    const c = createSessionRecoveryCoordinator()
    c.beginSnapshotRecovery("bootstrap")
    c.completeSnapshotRecovery(0)
    // First WS event arrives at sequence 1 — apply directly, no recover.
    expect(c.classifyEvent(1)).toBe("apply")
    // Even seq 2 without seq 1 should apply at latest=0 (bootstrap edge case).
    const c2 = createSessionRecoveryCoordinator()
    c2.beginSnapshotRecovery("bootstrap")
    c2.completeSnapshotRecovery(0)
    expect(c2.classifyEvent(7)).toBe("apply")
  })

  describe("circuit breaker", () => {
    it("Scenario: Coordinator gives up after N unsatisfied snapshots in a row — opens after MAX consecutive snapshots that fail to close the gap", () => {
      const c = createSessionRecoveryCoordinator()
      // Bootstrap with a low ceiling — broadcaster is way ahead.
      // Bootstrap with a non-zero baseline so the gap check (which skips
      // when latestSequence === 0) actually triggers on subsequent events.
      c.beginSnapshotRecovery("bootstrap")
      c.completeSnapshotRecovery(1000)

      // Simulate the broadcaster repeatedly emitting sequence 1500 while the
      // snapshot endpoint can only return up to 1000. Each round:
      //  1. event arrives → classify "recover", pendingReplay = true
      //  2. snapshot fires, returns 1000 — observedAhead still true
      for (let i = 0; i < MAX_CONSECUTIVE_UNSATISFIED_SNAPSHOTS; i++) {
        c.classifyEvent(1500)
        expect(c.getState().pendingReplay).toBe(true)
        c.beginSnapshotRecovery("sequence-gap")
        c.completeSnapshotRecovery(1000)
      }

      // Breaker should now be open and pendingReplay cleared — the React
      // effect would otherwise keep firing snapshots forever.
      expect(c.isCircuitOpen()).toBe(true)
      expect(c.getState().pendingReplay).toBe(false)
      // highestObservedSequence pinned to latest so a fresh classify of 1500
      // doesn't re-arm pendingReplay (it's no longer "ahead").
      expect(c.getState().highestObservedSequence).toBe(c.getState().latestSequence)
    })

    it("resets after a successful apply", () => {
      const c = createSessionRecoveryCoordinator()
      c.beginSnapshotRecovery("bootstrap")
      c.completeSnapshotRecovery(1000)

      // Trip the breaker.
      for (let i = 0; i < MAX_CONSECUTIVE_UNSATISFIED_SNAPSHOTS; i++) {
        c.classifyEvent(1500)
        c.beginSnapshotRecovery("sequence-gap")
        c.completeSnapshotRecovery(1000)
      }
      expect(c.isCircuitOpen()).toBe(true)

      // Real progress — applying an event resets the breaker.
      expect(c.classifyEvent(1001)).toBe("apply")
      c.markEventBatchApplied([{ sequence: 1001 }])
      expect(c.isCircuitOpen()).toBe(false)
    })

    it("Scenario: cursor_miss invalidates bootstrap — resets on invalidateBootstrap (cursor_miss recovery path)", () => {
      const c = createSessionRecoveryCoordinator()
      c.beginSnapshotRecovery("bootstrap")
      c.completeSnapshotRecovery(1000)
      for (let i = 0; i < MAX_CONSECUTIVE_UNSATISFIED_SNAPSHOTS; i++) {
        c.classifyEvent(1500)
        c.beginSnapshotRecovery("sequence-gap")
        c.completeSnapshotRecovery(1000)
      }
      expect(c.isCircuitOpen()).toBe(true)
      c.invalidateBootstrap()
      expect(c.isCircuitOpen()).toBe(false)
    })

    it("does NOT open when snapshot rounds successfully close the gap", () => {
      const c = createSessionRecoveryCoordinator()
      c.beginSnapshotRecovery("bootstrap")
      c.completeSnapshotRecovery(10)
      // Normal gap-recovery: each snapshot catches up.
      for (let i = 0; i < MAX_CONSECUTIVE_UNSATISFIED_SNAPSHOTS + 2; i++) {
        const seq = 11 + i
        c.classifyEvent(seq)
        c.beginSnapshotRecovery("sequence-gap")
        c.completeSnapshotRecovery(seq)
      }
      expect(c.isCircuitOpen()).toBe(false)
    })
  })
})
