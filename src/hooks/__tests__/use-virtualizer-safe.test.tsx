// @vitest-environment jsdom
import "@testing-library/jest-dom"
import { describe, it, expect, vi, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"

// Intercept React.startTransition before the hook module loads.
// vi.spyOn won't work across ESM module boundaries (named import bindings are
// captured at import time), so we use vi.hoisted + vi.mock to replace the
// export before the hook imports it.
const startTransitionMock = vi.hoisted(() => vi.fn((cb: () => void) => cb()))
vi.mock("react", async (importOriginal) => {
  const original = await importOriginal<typeof import("react")>()
  return { ...original, startTransition: startTransitionMock }
})

import { useVirtualizerSafe } from "../use-virtualizer-safe"

/**
 * useVirtualizerSafe prevents "Maximum update depth exceeded" in React 19 by
 * wrapping synchronous virtualizer updates (from measureElement ref callbacks)
 * in startTransition. Transition updates use TransitionLane, which React 19's
 * flushSyncWorkAcrossRoots_impl does NOT process synchronously — breaking the
 * cascade before it hits the 50-nested-update limit.
 *
 * TanStack Virtual sync semantics (from the source):
 *   sync=false → item size change (resizeItem always calls notify(false)) — CASCADE PATH
 *   sync=true  → scroll offset change — safe, needs immediate update
 *
 * These tests verify:
 *   1. startTransition is called for sync=false onChange (item resize — cascade path)
 *   2. startTransition is NOT called for sync=true onChange (scroll — immediate path)
 *   3. The hook returns a working Virtualizer instance
 */

describe("useVirtualizerSafe", () => {
  afterEach(() => {
    startTransitionMock.mockClear()
  })

  it("calls startTransition for sync=false onChange (item resize — cascade path)", () => {
    // sync=false is emitted by resizeItem (measureElement ref during commitAttachRef).
    // This is the cascade path. startTransition must be called to prevent it.
    const scrollEl = document.createElement("div")
    const { result } = renderHook(() =>
      useVirtualizerSafe({
        count: 5,
        getScrollElement: () => scrollEl,
        estimateSize: () => 44,
      }),
    )

    act(() => {
      result.current.options.onChange?.(result.current, false /* item resize */)
    })

    expect(startTransitionMock).toHaveBeenCalled()
  })

  it("does NOT call startTransition for sync=true onChange (scroll offset — immediate)", () => {
    // sync=true is emitted by _handleScroll. Scroll updates must be immediate
    // for smooth scrolling — they are not the cascade source.
    const scrollEl = document.createElement("div")
    const { result } = renderHook(() =>
      useVirtualizerSafe({
        count: 5,
        getScrollElement: () => scrollEl,
        estimateSize: () => 44,
      }),
    )

    act(() => {
      result.current.options.onChange?.(result.current, true /* scroll */)
    })

    expect(startTransitionMock).not.toHaveBeenCalled()
  })

  it("returns a Virtualizer instance with correct count", () => {
    const scrollEl = document.createElement("div")
    const { result } = renderHook(() =>
      useVirtualizerSafe({
        count: 10,
        getScrollElement: () => scrollEl,
        estimateSize: () => 44,
      }),
    )

    expect(typeof result.current.getVirtualItems).toBe("function")
    expect(result.current.options.count).toBe(10)
  })

  it("passes custom onChange through alongside startTransition wrapper", () => {
    const customOnChange = vi.fn()
    const scrollEl = document.createElement("div")
    const { result } = renderHook(() =>
      useVirtualizerSafe({
        count: 3,
        getScrollElement: () => scrollEl,
        estimateSize: () => 44,
        onChange: customOnChange,
      }),
    )

    act(() => {
      result.current.options.onChange?.(result.current, false)
    })

    expect(customOnChange).toHaveBeenCalledWith(result.current, false)
  })
})
