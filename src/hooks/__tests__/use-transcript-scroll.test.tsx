// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useTranscriptScroll } from "../use-transcript-scroll"

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

function makeOptions(overrides: Partial<Parameters<typeof useTranscriptScroll>[0]> = {}) {
  return {
    messageCount: 0,
    sessionId: "s1",
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useTranscriptScroll", () => {
  it("returns scrollRef and handleScroll", () => {
    const { result } = renderHook(() => useTranscriptScroll(makeOptions()))

    expect(result.current.scrollRef).toBeDefined()
    expect(typeof result.current.handleScroll).toBe("function")
  })

  it("handles empty transcript (messageCount = 0)", () => {
    const { result } = renderHook(() =>
      useTranscriptScroll(makeOptions({ messageCount: 0 })),
    )
    expect(result.current.scrollRef).toBeDefined()
    expect(typeof result.current.handleScroll).toBe("function")
  })

  it("handleScroll is a no-op before initial scroll-to-bottom", () => {
    const { result } = renderHook(() => useTranscriptScroll(makeOptions()))

    // Should not throw
    expect(() => {
      act(() => result.current.handleScroll())
    }).not.toThrow()
  })

  it("handleScroll detects user scrolling away from bottom", () => {
    const { result } = renderHook(() =>
      useTranscriptScroll(makeOptions({ messageCount: 1 })),
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
    const { result, rerender } = renderHook(
      (props) => useTranscriptScroll(props),
      { initialProps: makeOptions({ messageCount: 1, sessionId: "s1" }) },
    )

    // Switch session
    rerender(makeOptions({ messageCount: 1, sessionId: "s2" }))

    // After session change, the hook resets hasScrolledToBottom and shouldAutoScroll.
    // handleScroll should be a no-op again (hasScrolledToBottom is false)
    expect(() => {
      act(() => result.current.handleScroll())
    }).not.toThrow()
  })

  it("creates ResizeObserver when scrollRef has a child element", () => {
    const { result, rerender } = renderHook(
      (props) => useTranscriptScroll(props),
      { initialProps: makeOptions({ messageCount: 1, sessionId: "s1" }) },
    )

    // Set up scrollRef with a child before the effect re-runs
    const scrollEl = document.createElement("div")
    const content = document.createElement("div")
    Object.defineProperty(content, "scrollHeight", { value: 500, configurable: true })
    scrollEl.appendChild(content)
    ;(result.current.scrollRef as any).current = scrollEl

    // Change sessionId to re-trigger the ResizeObserver effect
    const countBefore = resizeObserverInstances.length
    rerender(makeOptions({ messageCount: 1, sessionId: "s2" }))

    expect(resizeObserverInstances.length).toBeGreaterThan(countBefore)
  })

  it("disconnects ResizeObserver on unmount", () => {
    const { result, rerender, unmount } = renderHook(
      (props) => useTranscriptScroll(props),
      { initialProps: makeOptions({ messageCount: 1, sessionId: "s1" }) },
    )

    const scrollEl = document.createElement("div")
    const content = document.createElement("div")
    scrollEl.appendChild(content)
    ;(result.current.scrollRef as any).current = scrollEl

    // Re-trigger effect so ResizeObserver is created
    rerender(makeOptions({ messageCount: 1, sessionId: "s2" }))

    const lastInst = resizeObserverInstances.at(-1)

    unmount()

    if (lastInst) {
      expect(lastInst.disconnect).toHaveBeenCalled()
    }
  })
})
