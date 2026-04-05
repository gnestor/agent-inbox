// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import React from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

// --- Mock WS stream before any imports that use it ---
type Callback = (data: any) => void
const _subs = new Map<string, Set<Callback>>()
const _mockSubscribe = (sessionId: string, callback: Callback) => {
  if (!_subs.has(sessionId)) _subs.set(sessionId, new Set())
  _subs.get(sessionId)!.add(callback)
  return () => {
    _subs.get(sessionId)?.delete(callback)
    if (_subs.get(sessionId)?.size === 0) _subs.delete(sessionId)
  }
}

vi.mock("@/hooks/use-ws-stream", () => ({
  useWsStream: () => ({ subscribe: _mockSubscribe, isConnected: true }),
}))

import { useSessionStream } from "../use-session-stream"

function emit(sessionId: string, data: any) {
  for (const cb of _subs.get(sessionId) ?? []) cb(data)
}

let qc: QueryClient
function W({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

beforeEach(() => {
  _subs.clear()
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(["session", "s1"], { session: { id: "s1", status: "running" }, messages: [] })
})

describe("useSessionStream", () => {
  it("pushes messages to cache", async () => {
    renderHook(() => useSessionStream("s1"), { wrapper: W })
    act(() => emit("s1", { sequence: 0, message: { type: "text", content: "hi" } }))
    await waitFor(() => {
      const d = qc.getQueryData(["session", "s1"]) as any
      expect(d.messages).toHaveLength(1)
    })
  })

  it("does not subscribe when undefined", () => {
    renderHook(() => useSessionStream(undefined), { wrapper: W })
    expect(_subs.size).toBe(0)
  })

  it("handles session_complete", async () => {
    renderHook(() => useSessionStream("s1"), { wrapper: W })
    act(() => emit("s1", { type: "session_complete" }))
    await waitFor(() => {
      const d = qc.getQueryData(["session", "s1"]) as any
      expect(d.session.status).toBe("complete")
    })
  })

  it("handles ask_user_question", async () => {
    const { result } = renderHook(() => useSessionStream("s1"), { wrapper: W })
    act(() => emit("s1", { type: "ask_user_question", questions: [{ question: "Q?" }] }))
    await waitFor(() => expect(result.current.pendingQuestion).not.toBeNull())
  })

  it("clearPendingQuestion works", async () => {
    const { result } = renderHook(() => useSessionStream("s1"), { wrapper: W })
    act(() => emit("s1", { type: "ask_user_question", questions: [{ question: "Q?" }] }))
    await waitFor(() => expect(result.current.pendingQuestion).not.toBeNull())
    act(() => result.current.clearPendingQuestion())
    expect(result.current.pendingQuestion).toBeNull()
  })

  it("unsubscribes on unmount", () => {
    const { unmount } = renderHook(() => useSessionStream("s1"), { wrapper: W })
    expect(_subs.has("s1")).toBe(true)
    unmount()
    expect(_subs.has("s1")).toBe(false)
  })
})
