// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useSessionStream } from "../use-session-stream"

// Minimal EventSource mock
class MockEventSource {
  static instances: MockEventSource[] = []
  listeners: Record<string, ((e: any) => void)[]> = {}
  readyState = 0
  url: string

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, fn: (e: any) => void) {
    if (!this.listeners[type]) this.listeners[type] = []
    this.listeners[type].push(fn)
  }

  emit(type: string, data?: any) {
    for (const fn of this.listeners[type] ?? []) fn(data ?? {})
  }

  close() {
    this.readyState = 2
  }
}

let queryClient: QueryClient

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

beforeEach(() => {
  MockEventSource.instances = []
  vi.stubGlobal("EventSource", MockEventSource)
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // Seed the cache with an empty session so setQueryData has something to update
  queryClient.setQueryData(["session", "session-1"], { session: { id: "session-1", status: "running" }, messages: [] })
  queryClient.setQueryData(["session", "session-2"], { session: { id: "session-2", status: "running" }, messages: [] })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("useSessionStream", () => {
  it("pushes messages to React Query cache", async () => {
    renderHook(() => useSessionStream("session-1"), { wrapper })
    const es = MockEventSource.instances[0]

    act(() => {
      es.emit("open")
      es.emit("message", {
        data: JSON.stringify({ sequence: 0, message: { type: "text", content: "hello" } }),
      })
    })

    await waitFor(() => {
      const data = queryClient.getQueryData(["session", "session-1"]) as any
      expect(data.messages).toHaveLength(1)
      expect(data.messages[0].sequence).toBe(0)
    })
  })

  it("resets state when sessionId changes", async () => {
    const { result, rerender } = renderHook(({ id }) => useSessionStream(id), {
      wrapper,
      initialProps: { id: "session-1" as string | undefined },
    })

    act(() => {
      MockEventSource.instances[0].emit("open")
    })
    expect(result.current.connected).toBe(true)

    rerender({ id: "session-2" })
    expect(result.current.connected).toBe(false)
    expect(result.current.sessionStatus).toBeNull()
  })

  it("does not open a stream when sessionId is undefined", () => {
    renderHook(() => useSessionStream(undefined), { wrapper })
    expect(MockEventSource.instances).toHaveLength(0)
  })

  it("sets pendingQuestion on ask_user_question event", async () => {
    const { result } = renderHook(() => useSessionStream("session-1"), { wrapper })
    const es = MockEventSource.instances[0]

    const questions = [
      { question: "Which?", header: "H", options: [{ label: "A" }], multiSelect: false },
    ]

    act(() => {
      es.emit("message", { data: JSON.stringify({ type: "ask_user_question", questions }) })
    })

    await waitFor(() => expect(result.current.pendingQuestion).not.toBeNull())
    expect(result.current.pendingQuestion?.questions).toEqual(questions)
    expect(result.current.sessionStatus).toBe("awaiting_user_input")
  })

  it("clears pendingQuestion on clearPendingQuestion()", async () => {
    const { result } = renderHook(() => useSessionStream("session-1"), { wrapper })
    const es = MockEventSource.instances[0]

    act(() => {
      es.emit("message", {
        data: JSON.stringify({
          type: "ask_user_question",
          questions: [{ question: "Q?", header: "H", options: [], multiSelect: false }],
        }),
      })
    })
    await waitFor(() => expect(result.current.pendingQuestion).not.toBeNull())

    act(() => result.current.clearPendingQuestion())
    expect(result.current.pendingQuestion).toBeNull()
  })

  it("updates session status in cache on session_complete", async () => {
    renderHook(() => useSessionStream("session-1"), { wrapper })
    const es = MockEventSource.instances[0]

    act(() => {
      es.emit("message", { data: JSON.stringify({ type: "session_complete" }) })
    })

    await waitFor(() => {
      const data = queryClient.getQueryData(["session", "session-1"]) as any
      expect(data.session.status).toBe("complete")
    })
  })
})
