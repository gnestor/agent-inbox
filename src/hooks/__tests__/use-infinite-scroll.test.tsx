// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, cleanup } from "@testing-library/react"
import { createElement } from "react"
import { useInfiniteScroll } from "../use-infinite-scroll"

// jsdom has no IntersectionObserver — capture instances to assert rootMargin
// and drive the callback.
let observers: FakeIO[]
class FakeIO {
  cb: IntersectionObserverCallback
  options?: IntersectionObserverInit
  observe = vi.fn()
  disconnect = vi.fn()
  constructor(cb: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.cb = cb
    this.options = options
    observers.push(this)
  }
  enter(isIntersecting: boolean) {
    this.cb([{ isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }
}

function mockSentinelTop(top: number) {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ top } as DOMRect)
}

function Probe(props: Parameters<typeof useInfiniteScroll>[0]) {
  const { sentinelRef } = useInfiniteScroll(props)
  return createElement("div", { ref: sentinelRef })
}

const VIEWPORT = 768
const PRELOAD = 72 * 50

beforeEach(() => {
  observers = []
  vi.stubGlobal("IntersectionObserver", FakeIO)
  window.innerHeight = VIEWPORT
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("useInfiniteScroll", () => {
  it("observes against the viewport with a downward rootMargin (fires before the bottom)", () => {
    mockSentinelTop(VIEWPORT + 100_000)
    render(createElement(Probe, { hasNextPage: true, isFetchingNextPage: false, fetchNextPage: vi.fn(), itemCount: 20 }))
    // No explicit root → viewport; expanded downward by the preload distance.
    expect(observers[0]?.options?.root ?? undefined).toBeUndefined()
    expect(observers[0]?.options?.rootMargin).toBe(`0px 0px ${PRELOAD}px 0px`)
  })

  it("eager-fills while the sentinel is within the preload zone", () => {
    mockSentinelTop(VIEWPORT + 100)
    const fetchNextPage = vi.fn()
    render(createElement(Probe, { hasNextPage: true, isFetchingNextPage: false, fetchNextPage, itemCount: 20 }))
    expect(fetchNextPage).toHaveBeenCalled()
  })

  it("does not fetch once the buffer extends beyond the preload zone", () => {
    mockSentinelTop(VIEWPORT + PRELOAD + 500)
    const fetchNextPage = vi.fn()
    render(createElement(Probe, { hasNextPage: true, isFetchingNextPage: false, fetchNextPage, itemCount: 20 }))
    expect(fetchNextPage).not.toHaveBeenCalled()
  })

  it("does not fetch with no next page or a fetch already in flight", () => {
    mockSentinelTop(VIEWPORT + 100)
    const noNext = vi.fn()
    render(createElement(Probe, { hasNextPage: false, isFetchingNextPage: false, fetchNextPage: noNext, itemCount: 20 }))
    expect(noNext).not.toHaveBeenCalled()
    const inFlight = vi.fn()
    render(createElement(Probe, { hasNextPage: true, isFetchingNextPage: true, fetchNextPage: inFlight, itemCount: 20 }))
    expect(inFlight).not.toHaveBeenCalled()
  })

  it("fetches when the sentinel enters the expanded root on scroll", () => {
    mockSentinelTop(VIEWPORT + 100_000)
    const fetchNextPage = vi.fn()
    render(createElement(Probe, { hasNextPage: true, isFetchingNextPage: false, fetchNextPage, itemCount: 20 }))
    expect(fetchNextPage).not.toHaveBeenCalled()
    observers[0]?.enter(true)
    expect(fetchNextPage).toHaveBeenCalledTimes(1)
  })
})
