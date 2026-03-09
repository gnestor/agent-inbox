// @vitest-environment jsdom
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest"
import { render, fireEvent } from "@testing-library/react"
import { useSwipe } from "../use-swipe.js"

// ─── Test harness ─────────────────────────────────────────────────────────────

type Dir = "left" | "right" | "up" | "down"

function SwipeTarget({ onSwipe, enabled }: { onSwipe: (dir: Dir) => void; enabled?: boolean }) {
  const ref = useSwipe(onSwipe, enabled)
  return <div data-testid="target" ref={ref} />
}

/** Fire a touchstart then (optionally advance fake time) then touchend. */
function swipe(el: Element, dx: number, dy: number, elapsedMs = 200) {
  fireEvent.touchStart(el, { touches: [{ clientX: 0, clientY: 0 }] })
  vi.advanceTimersByTime(elapsedMs)
  fireEvent.touchEnd(el, { changedTouches: [{ clientX: dx, clientY: dy }] })
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useSwipe", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ── Horizontal swipes ──────────────────────────────────────────────────────

  it('fires "right" on a rightward swipe ≥ 60px', () => {
    const onSwipe = vi.fn()
    const { getByTestId } = render(<SwipeTarget onSwipe={onSwipe} />)
    swipe(getByTestId("target"), 80, 0)
    expect(onSwipe).toHaveBeenCalledWith("right")
  })

  it('fires "left" on a leftward swipe ≥ 60px', () => {
    const onSwipe = vi.fn()
    const { getByTestId } = render(<SwipeTarget onSwipe={onSwipe} />)
    swipe(getByTestId("target"), -80, 0)
    expect(onSwipe).toHaveBeenCalledWith("left")
  })

  // ── Vertical swipes ────────────────────────────────────────────────────────

  it('fires "down" on a downward swipe ≥ 60px', () => {
    const onSwipe = vi.fn()
    const { getByTestId } = render(<SwipeTarget onSwipe={onSwipe} />)
    swipe(getByTestId("target"), 0, 80)
    expect(onSwipe).toHaveBeenCalledWith("down")
  })

  it('fires "up" on an upward swipe ≥ 60px', () => {
    const onSwipe = vi.fn()
    const { getByTestId } = render(<SwipeTarget onSwipe={onSwipe} />)
    swipe(getByTestId("target"), 0, -80)
    expect(onSwipe).toHaveBeenCalledWith("up")
  })

  // ── Distance threshold (MIN_DISTANCE = 60px) ──────────────────────────────

  it("does NOT fire when swipe distance is below 60px", () => {
    const onSwipe = vi.fn()
    const { getByTestId } = render(<SwipeTarget onSwipe={onSwipe} />)
    swipe(getByTestId("target"), 59, 0)
    expect(onSwipe).not.toHaveBeenCalled()
  })

  it("fires exactly at the 60px threshold", () => {
    const onSwipe = vi.fn()
    const { getByTestId } = render(<SwipeTarget onSwipe={onSwipe} />)
    swipe(getByTestId("target"), 60, 0)
    expect(onSwipe).toHaveBeenCalledWith("right")
  })

  // ── Elapsed-time gate (> 600ms = scroll, ignore) ──────────────────────────

  it("does NOT fire when the gesture takes longer than 600ms (slow drag / scroll)", () => {
    const onSwipe = vi.fn()
    const { getByTestId } = render(<SwipeTarget onSwipe={onSwipe} />)
    swipe(getByTestId("target"), 100, 0, 601)
    expect(onSwipe).not.toHaveBeenCalled()
  })

  it("fires when the gesture completes in exactly 600ms", () => {
    const onSwipe = vi.fn()
    const { getByTestId } = render(<SwipeTarget onSwipe={onSwipe} />)
    swipe(getByTestId("target"), 100, 0, 600)
    expect(onSwipe).toHaveBeenCalledWith("right")
  })

  // ── Cross-axis ratio (MAX_CROSS_RATIO = 0.75) ─────────────────────────────

  it("does NOT fire on a diagonal swipe where cross-axis exceeds 75% of main axis", () => {
    const onSwipe = vi.fn()
    const { getByTestId } = render(<SwipeTarget onSwipe={onSwipe} />)
    // dx=80, dy=61 → dy/dx ≈ 0.7625 > 0.75 → rejected
    swipe(getByTestId("target"), 80, 61, 200)
    expect(onSwipe).not.toHaveBeenCalled()
  })

  it("fires when cross-axis is just below the 75% ratio", () => {
    const onSwipe = vi.fn()
    const { getByTestId } = render(<SwipeTarget onSwipe={onSwipe} />)
    // dx=80, dy=59 → dy/dx ≈ 0.7375 < 0.75 → accepted
    swipe(getByTestId("target"), 80, 59, 200)
    expect(onSwipe).toHaveBeenCalledWith("right")
  })

  // ── Enabled flag ──────────────────────────────────────────────────────────

  it("does NOT fire when enabled=false", () => {
    const onSwipe = vi.fn()
    const { getByTestId } = render(<SwipeTarget onSwipe={onSwipe} enabled={false} />)
    swipe(getByTestId("target"), 100, 0)
    expect(onSwipe).not.toHaveBeenCalled()
  })

  // ── Stable callback ref (callback changes don't cause listener re-attachment) ──

  it("calls the latest callback without re-attaching listeners", () => {
    const first = vi.fn()
    const second = vi.fn()
    const { getByTestId, rerender } = render(<SwipeTarget onSwipe={first} />)

    rerender(<SwipeTarget onSwipe={second} />)
    swipe(getByTestId("target"), 100, 0)

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith("right")
  })
})
