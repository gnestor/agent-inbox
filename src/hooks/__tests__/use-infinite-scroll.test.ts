// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook } from "@testing-library/react"
import { useVirtualInfiniteScroll } from "../use-infinite-scroll"

function makeVirtualizer(endIndex: number, count: number, hasRange = true) {
  return {
    range: hasRange ? { startIndex: 0, endIndex } : null,
    options: { count },
  } as any
}

describe("useVirtualInfiniteScroll", () => {
  let loadMore: () => void

  beforeEach(() => {
    loadMore = vi.fn()
  })

  it("calls loadMore when near end of list", () => {
    const virtualizer = makeVirtualizer(90, 100)
    renderHook(() => useVirtualInfiniteScroll(virtualizer, loadMore, true, false))
    expect(loadMore).toHaveBeenCalledOnce()
  })

  it("does not call loadMore when far from end", () => {
    const virtualizer = makeVirtualizer(50, 100)
    renderHook(() => useVirtualInfiniteScroll(virtualizer, loadMore, true, false))
    expect(loadMore).not.toHaveBeenCalled()
  })

  it("does not call loadMore when hasMore is false", () => {
    const virtualizer = makeVirtualizer(95, 100)
    renderHook(() => useVirtualInfiniteScroll(virtualizer, loadMore, false, false))
    expect(loadMore).not.toHaveBeenCalled()
  })

  it("does not call loadMore when loading", () => {
    const virtualizer = makeVirtualizer(95, 100)
    renderHook(() => useVirtualInfiniteScroll(virtualizer, loadMore, true, true))
    expect(loadMore).not.toHaveBeenCalled()
  })

  it("does not call loadMore when range is null", () => {
    const virtualizer = makeVirtualizer(0, 100, false)
    renderHook(() => useVirtualInfiniteScroll(virtualizer, loadMore, true, false))
    expect(loadMore).not.toHaveBeenCalled()
  })

  it("respects custom overscan value", () => {
    // endIndex 90, count 100, overscan 5 → 90 >= 95 → should NOT trigger
    const virtualizer = makeVirtualizer(90, 100)
    renderHook(() => useVirtualInfiniteScroll(virtualizer, loadMore, true, false, 5))
    expect(loadMore).not.toHaveBeenCalled()

    // endIndex 96, count 100, overscan 5 → 96 >= 95 → should trigger
    const virtualizer2 = makeVirtualizer(96, 100)
    renderHook(() => useVirtualInfiniteScroll(virtualizer2, loadMore, true, false, 5))
    expect(loadMore).toHaveBeenCalledOnce()
  })
})
