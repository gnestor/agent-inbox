// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
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

beforeEach(() => {
  MockEventSource.instances = []
  vi.stubGlobal("EventSource", MockEventSource)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("useSessionStream", () => {
  it("resets messages, sessionStatus, and connected when sessionId changes", async () => {
    const { result, rerender } = renderHook(({ id }) => useSessionStream(id), {
      initialProps: { id: "session-1" as string | undefined },
    })

    const es1 = MockEventSource.instances[0]

    // Simulate a message arriving on session-1
    act(() => {
      es1.emit("open")
      es1.emit("message", {
        data: JSON.stringify({ sequence: 0, message: { type: "text", content: "hello" } }),
      })
    })

    await waitFor(() => expect(result.current.messages).toHaveLength(1))
    expect(result.current.connected).toBe(true)

    // Simulate status event
    act(() => {
      es1.emit("message", { data: JSON.stringify({ type: "session_complete" }) })
    })
    await waitFor(() => expect(result.current.sessionStatus).toBe("complete"))

    // Switch to a new session
    rerender({ id: "session-2" })

    // State should be reset immediately before the new stream emits anything
    expect(result.current.messages).toHaveLength(0)
    expect(result.current.sessionStatus).toBeNull()
    expect(result.current.connected).toBe(false)
  })

  it("accumulates messages from the new session after switching", async () => {
    const { result, rerender } = renderHook(({ id }) => useSessionStream(id), {
      initialProps: { id: "session-1" as string | undefined },
    })

    // Prime session-1 with a message
    act(() => {
      MockEventSource.instances[0].emit("message", {
        data: JSON.stringify({ sequence: 0, message: { type: "text" } }),
      })
    })
    await waitFor(() => expect(result.current.messages).toHaveLength(1))

    // Switch to session-2
    rerender({ id: "session-2" })
    expect(result.current.messages).toHaveLength(0)

    const es2 = MockEventSource.instances[1]
    act(() => {
      es2.emit("message", {
        data: JSON.stringify({ sequence: 0, message: { type: "assistant" } }),
      })
    })

    await waitFor(() => expect(result.current.messages).toHaveLength(1))
    expect(result.current.messages[0].sessionId).toBe("session-2")
  })

  it("does not open a stream when sessionId is undefined", () => {
    renderHook(() => useSessionStream(undefined))
    expect(MockEventSource.instances).toHaveLength(0)
  })

  it("sets pendingQuestion and awaiting_user_input status on ask_user_question event", async () => {
    const { result } = renderHook(() => useSessionStream("session-1"))
    const es = MockEventSource.instances[0]

    const questions = [
      {
        question: "Which context?",
        header: "Context",
        options: [{ label: "Email body", description: "The full email" }],
        multiSelect: true,
      },
    ]

    act(() => {
      es.emit("message", {
        data: JSON.stringify({ type: "ask_user_question", questions }),
      })
    })

    await waitFor(() => expect(result.current.pendingQuestion).not.toBeNull())
    expect(result.current.pendingQuestion?.questions).toEqual(questions)
    expect(result.current.sessionStatus).toBe("awaiting_user_input")
  })

  it("clears pendingQuestion on clearPendingQuestion()", async () => {
    const { result } = renderHook(() => useSessionStream("session-1"))
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

    act(() => {
      result.current.clearPendingQuestion()
    })
    expect(result.current.pendingQuestion).toBeNull()
  })

  it("clears pendingQuestion when session completes", async () => {
    const { result } = renderHook(() => useSessionStream("session-1"))
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

    act(() => {
      es.emit("message", { data: JSON.stringify({ type: "session_complete" }) })
    })
    await waitFor(() => expect(result.current.pendingQuestion).toBeNull())
    expect(result.current.sessionStatus).toBe("complete")
  })
})
