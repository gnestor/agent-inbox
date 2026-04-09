// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"

// --- Mock requestAnimationFrame for controlled rendering ---
let rafCallbacks: FrameRequestCallback[] = []
vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
  rafCallbacks.push(cb)
  return rafCallbacks.length
})
vi.stubGlobal("cancelAnimationFrame", () => {})

function flushRAF() {
  const cbs = [...rafCallbacks]
  rafCallbacks = []
  cbs.forEach((cb) => cb(performance.now()))
}

import { usePartialMessage } from "../use-partial-message"

beforeEach(() => {
  rafCallbacks = []
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("usePartialMessage", () => {
  it("starts with no partial message", () => {
    const { result } = renderHook(() => usePartialMessage("s1"))
    expect(result.current.partialMessage).toBeNull()
    expect(result.current.hasPartialMessage).toBe(false)
  })

  it("accumulates text deltas into a partial message", () => {
    const { result } = renderHook(() => usePartialMessage("s1"))

    act(() => {
      result.current.handleStreamEvent({
        type: "stream_event",
        session_id: "s1",
        parent_tool_use_id: null,
        uuid: "u1",
        event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      })
      result.current.handleStreamEvent({
        type: "stream_event",
        session_id: "s1",
        parent_tool_use_id: null,
        uuid: "u1",
        event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello " } },
      })
      result.current.handleStreamEvent({
        type: "stream_event",
        session_id: "s1",
        parent_tool_use_id: null,
        uuid: "u1",
        event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "world" } },
      })
      flushRAF()
    })

    expect(result.current.hasPartialMessage).toBe(true)
    expect(result.current.partialMessage).not.toBeNull()
    expect(result.current.partialMessage!.text).toBe("Hello world")
    expect(result.current.partialMessage!.isPartial).toBe(true)
  })

  it("accumulates thinking deltas separately from text", () => {
    const { result } = renderHook(() => usePartialMessage("s1"))

    act(() => {
      result.current.handleStreamEvent({
        type: "stream_event",
        session_id: "s1",
        parent_tool_use_id: null,
        uuid: "u1",
        event: { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
      })
      result.current.handleStreamEvent({
        type: "stream_event",
        session_id: "s1",
        parent_tool_use_id: null,
        uuid: "u1",
        event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Let me think..." } },
      })
      result.current.handleStreamEvent({
        type: "stream_event",
        session_id: "s1",
        parent_tool_use_id: null,
        uuid: "u1",
        event: { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
      })
      result.current.handleStreamEvent({
        type: "stream_event",
        session_id: "s1",
        parent_tool_use_id: null,
        uuid: "u1",
        event: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "The answer is 42" } },
      })
      flushRAF()
    })

    expect(result.current.hasPartialMessage).toBe(true)
    // Text should contain the text block content, not thinking
    expect(result.current.partialMessage!.text).toBe("The answer is 42")
  })

  it("ignores subagent events (parent_tool_use_id !== null)", () => {
    const { result } = renderHook(() => usePartialMessage("s1"))

    act(() => {
      result.current.handleStreamEvent({
        type: "stream_event",
        session_id: "s1",
        parent_tool_use_id: "tool-123",
        uuid: "u1",
        event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      })
      result.current.handleStreamEvent({
        type: "stream_event",
        session_id: "s1",
        parent_tool_use_id: "tool-123",
        uuid: "u1",
        event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "subagent text" } },
      })
      flushRAF()
    })

    expect(result.current.hasPartialMessage).toBe(false)
    expect(result.current.partialMessage).toBeNull()
  })

  it("clears partial message on clear()", () => {
    const { result } = renderHook(() => usePartialMessage("s1"))

    act(() => {
      result.current.handleStreamEvent({
        type: "stream_event",
        session_id: "s1",
        parent_tool_use_id: null,
        uuid: "u1",
        event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      })
      result.current.handleStreamEvent({
        type: "stream_event",
        session_id: "s1",
        parent_tool_use_id: null,
        uuid: "u1",
        event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hello" } },
      })
      flushRAF()
    })

    expect(result.current.hasPartialMessage).toBe(true)

    act(() => {
      result.current.clear()
    })

    expect(result.current.hasPartialMessage).toBe(false)
    expect(result.current.partialMessage).toBeNull()
  })

  it("resets accumulator when session changes", () => {
    const { result, rerender } = renderHook(
      ({ sessionId }) => usePartialMessage(sessionId),
      { initialProps: { sessionId: "s1" } },
    )

    act(() => {
      result.current.handleStreamEvent({
        type: "stream_event",
        session_id: "s1",
        parent_tool_use_id: null,
        uuid: "u1",
        event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      })
      result.current.handleStreamEvent({
        type: "stream_event",
        session_id: "s1",
        parent_tool_use_id: null,
        uuid: "u1",
        event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hello" } },
      })
      flushRAF()
    })

    expect(result.current.hasPartialMessage).toBe(true)

    rerender({ sessionId: "s2" })

    expect(result.current.hasPartialMessage).toBe(false)
    expect(result.current.partialMessage).toBeNull()
  })

  it("handles multiple text blocks", () => {
    const { result } = renderHook(() => usePartialMessage("s1"))

    act(() => {
      // First text block
      result.current.handleStreamEvent({
        type: "stream_event",
        session_id: "s1",
        parent_tool_use_id: null,
        uuid: "u1",
        event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      })
      result.current.handleStreamEvent({
        type: "stream_event",
        session_id: "s1",
        parent_tool_use_id: null,
        uuid: "u1",
        event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "First block. " } },
      })
      result.current.handleStreamEvent({
        type: "stream_event",
        session_id: "s1",
        parent_tool_use_id: null,
        uuid: "u1",
        event: { type: "content_block_stop", index: 0 },
      })
      // Second text block
      result.current.handleStreamEvent({
        type: "stream_event",
        session_id: "s1",
        parent_tool_use_id: null,
        uuid: "u1",
        event: { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
      })
      result.current.handleStreamEvent({
        type: "stream_event",
        session_id: "s1",
        parent_tool_use_id: null,
        uuid: "u1",
        event: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Second block." } },
      })
      flushRAF()
    })

    expect(result.current.hasPartialMessage).toBe(true)
    // Should contain text from both blocks
    expect(result.current.partialMessage!.text).toContain("First block.")
    expect(result.current.partialMessage!.text).toContain("Second block.")
  })

  it("sets pendingClear on message_stop", () => {
    const { result } = renderHook(() => usePartialMessage("s1"))

    act(() => {
      result.current.handleStreamEvent({
        type: "stream_event",
        session_id: "s1",
        parent_tool_use_id: null,
        uuid: "u1",
        event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      })
      result.current.handleStreamEvent({
        type: "stream_event",
        session_id: "s1",
        parent_tool_use_id: null,
        uuid: "u1",
        event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "done" } },
      })
      result.current.handleStreamEvent({
        type: "stream_event",
        session_id: "s1",
        parent_tool_use_id: null,
        uuid: "u1",
        event: { type: "message_stop" },
      })
      flushRAF()
    })

    // After message_stop, the partial should still be visible (waiting for complete message to replace it)
    // The caller (use-session-controller) will call clear() when the complete message arrives
    expect(result.current.hasPartialMessage).toBe(true)
  })
})
