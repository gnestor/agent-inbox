import { describe, it, expect } from "vitest"
import { createSessionRecoveryCoordinator } from "../session-recovery"

describe("session-recovery coordinator", () => {
  it("defers events until bootstrap is complete", () => {
    const c = createSessionRecoveryCoordinator()
    expect(c.classifyEvent(1)).toBe("defer")
    expect(c.classifyEvent(2)).toBe("defer")
    expect(c.getState().highestObservedSequence).toBe(2)
    expect(c.getState().pendingReplay).toBe(true)
  })

  it("bootstrap completes and resolves pendingReplay when observed > latest", () => {
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

  it("applies events in strict monotonic order after bootstrap", () => {
    const c = createSessionRecoveryCoordinator()
    c.beginSnapshotRecovery("bootstrap")
    c.completeSnapshotRecovery(0)
    expect(c.classifyEvent(1)).toBe("apply")
    c.markEventBatchApplied([{ sequence: 1 }])
    expect(c.classifyEvent(2)).toBe("apply")
    c.markEventBatchApplied([{ sequence: 2 }])
    expect(c.getState().latestSequence).toBe(2)
  })

  it("ignores duplicate sequences", () => {
    const c = createSessionRecoveryCoordinator()
    c.beginSnapshotRecovery("bootstrap")
    c.completeSnapshotRecovery(5)
    expect(c.classifyEvent(3)).toBe("ignore")
    expect(c.classifyEvent(5)).toBe("ignore")
  })

  it("detects gaps and returns recover", () => {
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

  it("defers events while snapshot is in flight", () => {
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

  it("failSnapshotRecovery clears inFlight so the caller can retry", () => {
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
})
