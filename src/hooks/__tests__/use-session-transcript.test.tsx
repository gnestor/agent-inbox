// @vitest-environment jsdom
import React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"

import { useSessionTranscript } from "../use-session-transcript"
import { useSessionStore } from "@/stores/session-store"
import * as client from "@/api/client"
import type { Session, SessionMessage } from "@/types"

// ---------------------------------------------------------------------------
// WsStream mock — we drive subscribe/onConnect callbacks directly from tests
// ---------------------------------------------------------------------------

let mostRecentEventCallback: ((event: any) => void) | null = null
let mostRecentConnectCallback: (() => void) | null = null
let mostRecentSubscribeOptions: any = null

vi.mock("@/hooks/use-ws-stream", () => ({
  useWsStream: () => ({
    subscribe: (_sessionId: string, cb: (e: any) => void, options?: any) => {
      mostRecentEventCallback = cb
      mostRecentSubscribeOptions = options ?? null
      return () => {
        if (mostRecentEventCallback === cb) mostRecentEventCallback = null
      }
    },
    onConnect: (cb: () => void) => {
      mostRecentConnectCallback = cb
      return () => {
        if (mostRecentConnectCallback === cb) mostRecentConnectCallback = null
      }
    },
    isConnected: true,
  }),
}))

vi.mock("@/api/client", async (orig) => {
  const actual = await (orig as any)()
  return { ...actual, getSession: vi.fn() }
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "s1",
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
  mostRecentEventCallback = null
  mostRecentConnectCallback = null
  mostRecentSubscribeOptions = null
  vi.mocked(client.getSession).mockReset()
  const s = useSessionStore.getState()
  for (const id of Object.keys(s.sessions)) s.removeSession(id)
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useSessionTranscript", () => {
  it("runs bootstrap snapshot when WS is already connected at mount", async () => {
    vi.mocked(client.getSession).mockResolvedValueOnce({
      session: makeSession(),
      messages: [makeMsg(0, "user", "hi")],
    })

    renderHook(() => useSessionTranscript("s1"))
    // onConnect fires immediately (queueMicrotask in the real provider; in
    // our mock the callback is just registered. Trigger it manually.)
    mostRecentConnectCallback?.()

    await waitFor(() => {
      expect(useSessionStore.getState().sessions["s1"]?.messageIds).toEqual([0])
    })
  })

  it("applies live events after bootstrap", async () => {
    vi.mocked(client.getSession).mockResolvedValueOnce({
      session: makeSession(),
      messages: [makeMsg(0, "user", "hi")],
    })
    renderHook(() => useSessionTranscript("s1"))
    mostRecentConnectCallback?.()
    await waitFor(() => {
      expect(useSessionStore.getState().sessions["s1"]?.recovery.bootstrapped).toBe(true)
    })

    // Server broadcasts a new event
    mostRecentEventCallback?.({
      sequence: 1,
      message: { type: "assistant", content: [{ type: "text", text: "ok" }] },
    })

    // Ingest is batched on requestAnimationFrame — wait for the next frame.
    await waitFor(() => {
      expect(useSessionStore.getState().sessions["s1"]?.messageIds).toEqual([0, 1])
    })
  })

  it("REGRESSION: StrictMode double-mount mid-fetch does not leak inFlight", async () => {
    // This is the exact scenario that caused the production bugs:
    //   1. Mount 1: beginSnapshot acquires inFlight. fetch starts.
    //   2. StrictMode cleanup: tears down subscriptions.
    //   3. Mount 2: beginSnapshot would return false if inFlight leaked.
    //   4. Mount 1's fetch eventually resolves.
    //
    // With the fix, either mount 1 or mount 2 applies the snapshot; the
    // coordinator's inFlight must be cleared, and subsequent live events
    // must apply rather than deferring forever.

    let resolveFetch1: (data: any) => void = () => {}
    const firstFetch = new Promise<any>((resolve) => { resolveFetch1 = resolve })
    let resolveFetch2: (data: any) => void = () => {}
    const secondFetch = new Promise<any>((resolve) => { resolveFetch2 = resolve })

    vi.mocked(client.getSession)
      .mockImplementationOnce(() => firstFetch)
      .mockImplementationOnce(() => secondFetch)

    // Mount 1
    const hook1 = renderHook(() => useSessionTranscript("s1"))
    mostRecentConnectCallback?.() // kicks off snapshot #1

    // Unmount (simulates StrictMode cleanup mid-flight)
    hook1.unmount()

    // Mount 2 (simulates StrictMode re-run)
    renderHook(() => useSessionTranscript("s1"))
    mostRecentConnectCallback?.() // kicks off snapshot #2 (or returns false if inFlight leaked)

    // Resolve the first fetch AFTER the second mount. Before the fix this
    // would return early via `if (!alive) return` and leak inFlight.
    resolveFetch1({
      session: makeSession(),
      messages: [makeMsg(0, "user", "hi")],
    })

    // If mount 2 also started a fetch (because mount 1 didn't leak inFlight),
    // resolve it too.
    resolveFetch2({
      session: makeSession(),
      messages: [makeMsg(0, "user", "hi")],
    })

    await waitFor(() => {
      const rec = useSessionStore.getState().sessions["s1"]?.recovery
      expect(rec?.bootstrapped).toBe(true)
      expect(rec?.inFlight).toBeNull()
    })

    // Now a live event must apply, not defer. This is the symptom the user
    // hit: after the race, every WS event classified as "defer" forever.
    mostRecentEventCallback?.({
      sequence: 1,
      message: { type: "assistant", content: [{ type: "text", text: "ok" }] },
    })

    await waitFor(() => {
      expect(useSessionStore.getState().sessions["s1"]?.messageIds).toEqual([0, 1])
    })
    expect(useSessionStore.getState().sessions["s1"]?.deferredEvents).toHaveLength(0)
  })

  it("getFromSequence returns the latest applied sequence for cursor replay", async () => {
    vi.mocked(client.getSession).mockResolvedValueOnce({
      session: makeSession(),
      messages: [makeMsg(0, "user"), makeMsg(1, "assistant")],
    })
    renderHook(() => useSessionTranscript("s1"))
    mostRecentConnectCallback?.()
    await waitFor(() => {
      expect(useSessionStore.getState().sessions["s1"]?.recovery.latestSequence).toBe(1)
    })

    expect(mostRecentSubscribeOptions?.getFromSequence()).toBe(1)
  })

  it("getFromSequence returns undefined before bootstrap so server skips replay", async () => {
    renderHook(() => useSessionTranscript("s1"))
    // No snapshot yet — cursor should be undefined.
    expect(mostRecentSubscribeOptions?.getFromSequence()).toBeUndefined()
  })

  it("onCursorMiss invalidates bootstrap and the gap effect runs a fresh snapshot", async () => {
    // Seed a bootstrapped session
    vi.mocked(client.getSession).mockResolvedValueOnce({
      session: makeSession(),
      messages: [makeMsg(0, "user"), makeMsg(1, "assistant")],
    })
    renderHook(() => useSessionTranscript("s1"))
    mostRecentConnectCallback?.()
    await waitFor(() => {
      expect(useSessionStore.getState().sessions["s1"]?.recovery.bootstrapped).toBe(true)
    })

    // Queue a second getSession resolution for the cursor_miss snapshot.
    vi.mocked(client.getSession).mockResolvedValueOnce({
      session: makeSession(),
      messages: [makeMsg(0, "user"), makeMsg(1, "assistant"), makeMsg(2, "assistant")],
    })

    // Server says: cursor is too old.
    mostRecentSubscribeOptions?.onCursorMiss()

    // Gap effect should run another snapshot; new messageIds include seq 2.
    await waitFor(() => {
      expect(useSessionStore.getState().sessions["s1"]?.messageIds).toContain(2)
    })
    expect(useSessionStore.getState().sessions["s1"]?.recovery.bootstrapped).toBe(true)
  })

  it("REGRESSION: gap-triggered snapshot releases inFlight on failure", async () => {
    // Set up a bootstrapped session, then inject an event with a gap to
    // force the coordinator into pendingReplay.
    vi.mocked(client.getSession).mockResolvedValueOnce({
      session: makeSession(),
      messages: [makeMsg(0, "user"), makeMsg(1, "assistant")],
    })
    renderHook(() => useSessionTranscript("s1"))
    mostRecentConnectCallback?.()
    await waitFor(() => {
      expect(useSessionStore.getState().sessions["s1"]?.recovery.latestSequence).toBe(1)
    })

    // Gap: seq 5 arrives, seq 2-4 are missing. Event goes into deferred and
    // pendingReplay is set.
    mostRecentEventCallback?.({
      sequence: 5,
      message: { type: "assistant", content: [] },
    })

    // The gap-triggered effect fires another snapshot. Make it reject.
    vi.mocked(client.getSession).mockRejectedValueOnce(new Error("network down"))

    await waitFor(() => {
      const rec = useSessionStore.getState().sessions["s1"]?.recovery
      // After failure, inFlight MUST be released so future attempts can run.
      expect(rec?.inFlight).toBeNull()
    })
  })
})
