// @vitest-environment jsdom
import { vi, describe, it, expect, beforeEach } from "vitest"
import {
  smoothScrollTo,
  getScrollTarget,
  classifyTabDrag,
  classifyOverlayDrag,
  itemVariants,
  tabVariants,
} from "../PanelStack.js"

// ─── smoothScrollTo ────────────────────────────────────────────────────────────

describe("smoothScrollTo", () => {
  let el: HTMLElement
  let rafRef: { current: number }
  let now: number
  let rafCallbacks: Array<(t: number) => void>

  beforeEach(() => {
    el = document.createElement("div")
    Object.defineProperty(el, "scrollLeft", { writable: true, value: 0 })
    rafRef = { current: 0 }
    now = 0
    rafCallbacks = []

    vi.spyOn(performance, "now").mockImplementation(() => now)

    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((cb: FrameRequestCallback) => {
        const id = rafCallbacks.push(cb)
        return id
      }),
    )
    vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => { rafCallbacks[id - 1] = () => {} }))
  })

  function flush(elapsed: number) {
    now += elapsed
    const cbs = [...rafCallbacks]
    rafCallbacks = []
    cbs.forEach((cb) => cb(now))
  }

  it("does nothing when distance is 0", () => {
    el.scrollLeft = 100
    smoothScrollTo(el, 100, rafRef)
    flush(100)
    expect(el.scrollLeft).toBe(100)
    expect(requestAnimationFrame).not.toHaveBeenCalled()
  })

  it("sets scrollLeft to target at t=1", () => {
    smoothScrollTo(el, 500, rafRef)
    flush(600) // full DURATION (600ms)
    expect(el.scrollLeft).toBe(500)
  })

  it("partially advances scrollLeft at t=0.5 with cubic-out easing", () => {
    smoothScrollTo(el, 500, rafRef)
    flush(300) // half duration (300ms of 600ms)
    // cubic ease-out at t=0.5: eased = 1-(1-0.5)^3 = 1-0.125 = 0.875
    expect(el.scrollLeft).toBeCloseTo(500 * 0.875, 0)
  })

  it("does not overshoot target", () => {
    smoothScrollTo(el, 200, rafRef)
    flush(800) // beyond DURATION
    expect(el.scrollLeft).toBe(200)
  })

  it("cancels a previous animation before starting a new one", () => {
    el.scrollLeft = 0
    smoothScrollTo(el, 500, rafRef) // starts first animation
    const firstRafId = rafRef.current
    smoothScrollTo(el, 100, rafRef) // starts second, should cancel first
    expect(cancelAnimationFrame).toHaveBeenCalledWith(firstRafId)
    flush(600)
    expect(el.scrollLeft).toBe(100) // only second animation ran
  })

  it("animates backwards (right to left)", () => {
    el.scrollLeft = 632
    smoothScrollTo(el, 0, rafRef)
    flush(600)
    expect(el.scrollLeft).toBe(0)
  })
})

// ─── getScrollTarget ───────────────────────────────────────────────────────────

describe("getScrollTarget", () => {
  // scrollWidth=1232, clientWidth=900, scrollLeft=332 (scrolled to see detail+session)
  const sw = 1232
  const cw = 900
  const sl = 332

  it("returns null when nothing changed", () => {
    expect(getScrollTarget("a", "a", false, false, sl, sw, cw)).toBeNull()
    expect(getScrollTarget("a", "a", true, true, sl, sw, cw)).toBeNull()
  })

  it("detailAdded: scroll to end", () => {
    const result = getScrollTarget(undefined, "a", false, false, 0, 1200, 900)
    expect(result).toEqual({ target: 300 })
  })

  it("detailRemoved: scroll to 0", () => {
    const result = getScrollTarget("a", undefined, false, false, 200, 1200, 900)
    expect(result).toEqual({ target: 0 })
  })

  it("sessionAdded: deferred scroll to end", () => {
    const result = getScrollTarget("a", "a", false, true, 0, sw, cw)
    expect(result).toEqual({ target: sw - cw, deferred: true })
  })

  it("sessionRemoved: scroll left by 632", () => {
    const result = getScrollTarget("a", "a", true, false, sl, sw, cw)
    expect(result).toEqual({ target: Math.max(0, sl - 632) })
  })

  it("sessionRemoved clamps to 0 when scrollLeft < 632", () => {
    const result = getScrollTarget("a", "a", true, false, 200, sw, cw)
    expect(result).toEqual({ target: 0 })
  })

  it("item switch without session change returns null", () => {
    expect(getScrollTarget("a", "b", false, false, sl, sw, cw)).toBeNull()
    expect(getScrollTarget("a", "b", true, true, sl, sw, cw)).toBeNull()
  })
})

// ─── itemVariants ──────────────────────────────────────────────────────────────

describe("itemVariants", () => {
  // direction >= 0: next item is below current (scroll down)
  it("enter from below when direction >= 0", () => {
    expect(itemVariants.enter(1)).toEqual({ y: "calc(100% + 16px)" })
    expect(itemVariants.enter(0)).toEqual({ y: "calc(100% + 16px)" })
  })

  it("enter from above when direction < 0", () => {
    expect(itemVariants.enter(-1)).toEqual({ y: "calc(-100% - 16px)" })
  })

  it("center is y=0", () => {
    expect(itemVariants.center).toEqual({ y: 0 })
  })

  it("exit upward when direction >= 0", () => {
    expect(itemVariants.exit(1)).toEqual({ y: "calc(-100% - 16px)" })
  })

  it("exit downward when direction < 0", () => {
    expect(itemVariants.exit(-1)).toEqual({ y: "calc(100% + 16px)" })
  })
})

// ─── tabVariants ───────────────────────────────────────────────────────────────

describe("tabVariants", () => {
  it("enter from below when direction >= 0", () => {
    expect(tabVariants.enter(1)).toEqual({ y: "calc(100% + 16px)" })
  })

  it("enter from above when direction < 0", () => {
    expect(tabVariants.enter(-1)).toEqual({ y: "calc(-100% - 16px)" })
  })

  it("center is y=0", () => {
    expect(tabVariants.center).toEqual({ y: 0 })
  })

  it("exit upward when direction >= 0", () => {
    expect(tabVariants.exit(1)).toEqual({ y: "calc(-100% - 16px)" })
  })

  it("exit downward when direction < 0", () => {
    expect(tabVariants.exit(-1)).toEqual({ y: "calc(100% + 16px)" })
  })
})

// ─── classifyTabDrag ───────────────────────────────────────────────────────────
// TAB_SWIPE_VELOCITY = 400, TAB_SWIPE_THRESHOLD = 0.1
// "prev" = drag DOWN (positive oy / vy) → navigate to previous tab
// "next" = drag UP   (negative oy / vy) → navigate to next tab

describe("classifyTabDrag", () => {
  const H = 800 // threshold = H * 0.1 = 80, up-threshold = H * 0.05 = 40

  it("returns null for small slow drag", () => {
    expect(classifyTabDrag(0, 0, H)).toBeNull()
    expect(classifyTabDrag(100, 50, H)).toBeNull()
  })

  it('"prev" when oy exceeds 10% of height', () => {
    expect(classifyTabDrag(0, 81, H)).toBe("prev")
  })

  it("does NOT fire at exactly the 10% threshold (strictly greater)", () => {
    expect(classifyTabDrag(0, 80, H)).toBeNull()
  })

  it('"prev" when vy exceeds velocity threshold', () => {
    expect(classifyTabDrag(401, 0, H)).toBe("prev")
  })

  it("does NOT fire at exactly TAB_SWIPE_VELOCITY", () => {
    expect(classifyTabDrag(400, 0, H)).toBeNull()
  })

  it('"next" when vy is below -TAB_SWIPE_VELOCITY', () => {
    expect(classifyTabDrag(-401, 0, H)).toBe("next")
  })

  it('"next" when oy is below -5% of height', () => {
    expect(classifyTabDrag(0, -41, H)).toBe("next")
  })

  it("does NOT fire at exactly -5% threshold", () => {
    expect(classifyTabDrag(0, -40, H)).toBeNull()
  })
})

// ─── classifyOverlayDrag ───────────────────────────────────────────────────────
// DISMISS_VELOCITY = 400, DISMISS_THRESHOLD = 0.1
// TAB_SWIPE_VELOCITY = 400, TAB_SWIPE_THRESHOLD = 0.1

describe("classifyOverlayDrag", () => {
  const W = 1000
  const H = 800

  // ── Dismiss (swipe right) ────────────────────────────────────────────────────

  it('"dismiss" when vx > DISMISS_VELOCITY', () => {
    expect(classifyOverlayDrag(401, 0, 0, 0, W, H, false)).toBe("dismiss")
  })

  it('"dismiss" when ox > 30% of width', () => {
    expect(classifyOverlayDrag(0, 0, W * 0.3 + 1, 0, W, H, false)).toBe("dismiss")
  })

  it("does NOT dismiss at exactly DISMISS_VELOCITY", () => {
    expect(classifyOverlayDrag(400, 0, 0, 0, W, H, false)).toBeNull()
  })

  // ── Forward (swipe left) ─────────────────────────────────────────────────────

  it('"forward" when vx < -DISMISS_VELOCITY', () => {
    expect(classifyOverlayDrag(-401, 0, 0, 0, W, H, false)).toBe("forward")
  })

  it('"forward" when ox < -30% of width', () => {
    expect(classifyOverlayDrag(0, 0, -(W * 0.3 + 1), 0, W, H, false)).toBe("forward")
  })

  // ── Tab swipe (vertical-dominant, hasTabSwipe=true) ──────────────────────────

  it('"tabPrev" when oy > 35% of height and vertical-dominant', () => {
    // oy=281 > H*0.35=280, |oy|=281 > |ox|=0
    expect(classifyOverlayDrag(0, 0, 0, 281, W, H, true)).toBe("tabPrev")
  })

  it('"tabPrev" on fast downward swipe (velocity) when vertical-dominant', () => {
    // vy=401, |oy|=100 > |ox|=50
    expect(classifyOverlayDrag(0, 401, 50, 100, W, H, true)).toBe("tabPrev")
  })

  it('"tabNext" on fast upward swipe (velocity) when vertical-dominant', () => {
    // vy=-401, |oy|=100 > |ox|=50
    expect(classifyOverlayDrag(0, -401, 50, -100, W, H, true)).toBe("tabNext")
  })

  it('"tabNext" when oy < -5% of height and vertical-dominant', () => {
    // oy=-41 < -H*0.05=-40, |oy|=41 > |ox|=0
    expect(classifyOverlayDrag(0, 0, 0, -41, W, H, true)).toBe("tabNext")
  })

  it("vertical-dominant slow drag returns null — does NOT fall through to dismiss/forward", () => {
    // |oy|=50 > |ox|=25, but vy=50 < 400 and oy=50 < H*0.1=80
    expect(classifyOverlayDrag(0, 50, 25, 50, W, H, true)).toBeNull()
  })

  // ── hasTabSwipe=false — vertical gesture falls through to horizontal ──────────

  it("vertical-dominant gesture uses horizontal logic when hasTabSwipe=false", () => {
    // Fast downward swipe, but no tab swipe → falls to horizontal (vx/ox below threshold)
    expect(classifyOverlayDrag(0, 401, 50, 100, W, H, false)).toBeNull()
  })

  it("fast rightward swipe is dismiss regardless of hasTabSwipe", () => {
    expect(classifyOverlayDrag(401, 0, 0, 0, W, H, true)).toBe("dismiss")
    expect(classifyOverlayDrag(401, 0, 0, 0, W, H, false)).toBe("dismiss")
  })

  // ── No gesture ───────────────────────────────────────────────────────────────

  it("returns null for a small gesture below all thresholds", () => {
    expect(classifyOverlayDrag(0, 0, 0, 0, W, H, true)).toBeNull()
    expect(classifyOverlayDrag(0, 0, 0, 0, W, H, false)).toBeNull()
  })
})
