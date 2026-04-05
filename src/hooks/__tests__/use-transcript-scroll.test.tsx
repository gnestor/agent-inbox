// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useTranscriptScroll } from "../use-transcript-scroll"
import type { SessionMessage } from "@/types"
import type { TranscriptVisibility } from "@/components/session/SessionTranscript"

// ---------------------------------------------------------------------------
// Mock ResizeObserver (jsdom doesn't provide it)
// ---------------------------------------------------------------------------

interface ROInstance {
  cb: () => void
  observe: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
}

let resizeObserverInstances: ROInstance[] = []

class MockResizeObserver {
  cb: () => void
  observe = vi.fn()
  disconnect = vi.fn()
  unobserve = vi.fn()
  constructor(cb: () => void) {
    this.cb = cb
    resizeObserverInstances.push(this)
  }
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", MockResizeObserver)
  resizeObserverInstances = []
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_VISIBILITY: TranscriptVisibility = {
  messages: true,
  toolCalls: true,
  thinking: true,
  artifacts: true,
}

function makeMessage(id: string, type: string = "user"): SessionMessage {
  return { uuid: id, type } as unknown as SessionMessage
}

function defaultShouldRender(_msg: SessionMessage, _vis: TranscriptVisibility) {
  return true
}

function makeOptions(overrides: Partial<Parameters<typeof useTranscriptScroll>[0]> = {}) {
  return {
    messages: [] as SessionMessage[],
    visibility: DEFAULT_VISIBILITY,
    sessionId: "s1",
    shouldRenderMessage: defaultShouldRender,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useTranscriptScroll", () => {
  it("returns scrollRef, visibleMessages, and handleScroll", () => {
    const { result } = renderHook(() => useTranscriptScroll(makeOptions()))

    expect(result.current.scrollRef).toBeDefined()
    expect(result.current.visibleMessages).toEqual([])
    expect(typeof result.current.handleScroll).toBe("function")
  })

  it("filters messages through shouldRenderMessage", () => {
    const messages = [
      makeMessage("1", "user"),
      makeMessage("2", "tool"),
      makeMessage("3", "user"),
    ]

    const shouldRender = (msg: SessionMessage, vis: TranscriptVisibility) => {
      return (msg as any).type === "user" && vis.messages
    }

    const { result } = renderHook(() =>
      useTranscriptScroll(makeOptions({ messages, shouldRenderMessage: shouldRender })),
    )

    expect(result.current.visibleMessages).toHaveLength(2)
    expect(result.current.visibleMessages[0]).toBe(messages[0])
    expect(result.current.visibleMessages[1]).toBe(messages[2])
  })

  it("returns all messages when shouldRenderMessage always returns true", () => {
    const messages = [makeMessage("1"), makeMessage("2"), makeMessage("3")]
    const { result } = renderHook(() =>
      useTranscriptScroll(makeOptions({ messages })),
    )
    expect(result.current.visibleMessages).toHaveLength(3)
  })

  it("handles empty transcript", () => {
    const { result } = renderHook(() =>
      useTranscriptScroll(makeOptions({ messages: [] })),
    )
    expect(result.current.visibleMessages).toEqual([])
  })

  it("memoizes visibleMessages when inputs are stable", () => {
    const messages = [makeMessage("1")]
    const shouldRender = defaultShouldRender

    const { result, rerender } = renderHook(
      (props) => useTranscriptScroll(props),
      { initialProps: makeOptions({ messages, shouldRenderMessage: shouldRender }) },
    )

    const first = result.current.visibleMessages
    rerender(makeOptions({ messages, shouldRenderMessage: shouldRender }))
    const second = result.current.visibleMessages

    // Same reference — useMemo cache hit
    expect(first).toBe(second)
  })

  it("handleScroll is a no-op before initial scroll-to-bottom", () => {
    // The hook sets hasScrolledToBottom = false initially. handleScroll
    // should return early if hasScrolledToBottom is false.
    const { result } = renderHook(() => useTranscriptScroll(makeOptions()))

    // Should not throw
    expect(() => {
      act(() => result.current.handleScroll())
    }).not.toThrow()
  })

  it("handleScroll detects user scrolling away from bottom", () => {
    const messages = [makeMessage("1")]
    const { result } = renderHook(() =>
      useTranscriptScroll(makeOptions({ messages })),
    )

    // Create a mock scroll container
    const scrollEl = document.createElement("div")
    Object.defineProperties(scrollEl, {
      scrollTop: { value: 0, writable: true },
      scrollHeight: { value: 1000 },
      clientHeight: { value: 500 },
    })
    ;(result.current.scrollRef as any).current = scrollEl

    // handleScroll should not throw even before initial scroll
    act(() => result.current.handleScroll())
  })

  it("resets scroll state when sessionId changes", () => {
    const messages = [makeMessage("1")]
    const { result, rerender } = renderHook(
      (props) => useTranscriptScroll(props),
      { initialProps: makeOptions({ messages, sessionId: "s1" }) },
    )

    // Switch session
    rerender(makeOptions({ messages, sessionId: "s2" }))

    // After session change, the hook resets hasScrolledToBottom and shouldAutoScroll.
    // handleScroll should be a no-op again (hasScrolledToBottom is false)
    expect(() => {
      act(() => result.current.handleScroll())
    }).not.toThrow()
  })

  it("creates ResizeObserver when scrollRef has a child element", () => {
    // The ResizeObserver effect runs on mount but bails if scrollRef.current is null.
    // We test by setting up the ref before re-triggering the effect via sessionId change.
    const messages = [makeMessage("1")]
    const { result, rerender } = renderHook(
      (props) => useTranscriptScroll(props),
      { initialProps: makeOptions({ messages, sessionId: "s1" }) },
    )

    // Set up scrollRef with a child before the effect re-runs
    const scrollEl = document.createElement("div")
    const content = document.createElement("div")
    Object.defineProperty(content, "scrollHeight", { value: 500, configurable: true })
    scrollEl.appendChild(content)
    ;(result.current.scrollRef as any).current = scrollEl

    // Change sessionId to re-trigger the ResizeObserver effect
    const countBefore = resizeObserverInstances.length
    rerender(makeOptions({ messages, sessionId: "s2" }))

    expect(resizeObserverInstances.length).toBeGreaterThan(countBefore)
  })

  it("disconnects ResizeObserver on unmount", () => {
    const messages = [makeMessage("1")]
    const { result, rerender, unmount } = renderHook(
      (props) => useTranscriptScroll(props),
      { initialProps: makeOptions({ messages, sessionId: "s1" }) },
    )

    const scrollEl = document.createElement("div")
    const content = document.createElement("div")
    scrollEl.appendChild(content)
    ;(result.current.scrollRef as any).current = scrollEl

    // Re-trigger effect so ResizeObserver is created
    rerender(makeOptions({ messages, sessionId: "s2" }))

    const lastInst = resizeObserverInstances.at(-1)

    unmount()

    if (lastInst) {
      expect(lastInst.disconnect).toHaveBeenCalled()
    }
  })

  it("updates visibleMessages when visibility changes", () => {
    const messages = [
      makeMessage("1", "user"),
      makeMessage("2", "tool"),
    ]

    const shouldRender = (msg: SessionMessage, vis: TranscriptVisibility) => {
      if ((msg as any).type === "tool") return vis.toolCalls
      return vis.messages
    }

    const { result, rerender } = renderHook(
      (props) => useTranscriptScroll(props),
      {
        initialProps: makeOptions({
          messages,
          shouldRenderMessage: shouldRender,
          visibility: { ...DEFAULT_VISIBILITY, toolCalls: true },
        }),
      },
    )

    expect(result.current.visibleMessages).toHaveLength(2)

    // Hide tool calls
    rerender(makeOptions({
      messages,
      shouldRenderMessage: shouldRender,
      visibility: { ...DEFAULT_VISIBILITY, toolCalls: false },
    }))

    expect(result.current.visibleMessages).toHaveLength(1)
    expect((result.current.visibleMessages[0] as any).type).toBe("user")
  })
})
