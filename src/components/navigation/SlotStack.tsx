/**
 * SlotStack — vertical scroll container for tab transitions.
 *
 * Uses native scrollTop positioning with an explicit animation state machine.
 * The reducer makes the scroll state visible and prevents the ResizeObserver
 * from fighting an in-progress animation.
 */
import { useRef, useEffect, useLayoutEffect, useReducer, useCallback, memo, type ReactNode } from "react"
import { EASE } from "@/lib/navigation-constants"

/** Fixed duration for tab scroll transitions (ms) */
const TAB_SCROLL_DURATION = 1000

/** Evaluate cubic-bezier(EASE) at progress t ∈ [0,1] using binary search */
function cubicBezier(t: number): number {
  const [x1, y1, x2, y2] = EASE
  let lo = 0, hi = 1
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2
    const x = 3 * x1 * mid * (1 - mid) ** 2 + 3 * x2 * mid ** 2 * (1 - mid) + mid ** 3
    if (x < t) lo = mid; else hi = mid
  }
  const u = (lo + hi) / 2
  return 3 * y1 * u * (1 - u) ** 2 + 3 * y2 * u ** 2 * (1 - u) + u ** 3
}

// --- Animation state machine ---

type ScrollState =
  | { status: "initial" }
  | { status: "idle" }
  | { status: "animating"; from: number; to: number; startTime: number }

type ScrollAction =
  | { type: "INITIALIZED" }
  | { type: "ANIMATE"; from: number; to: number }
  | { type: "COMPLETE" }

function scrollReducer(state: ScrollState, action: ScrollAction): ScrollState {
  switch (action.type) {
    case "INITIALIZED":
      return { status: "idle" }
    case "ANIMATE":
      return { status: "animating", from: action.from, to: action.to, startTime: performance.now() }
    case "COMPLETE":
      return { status: "idle" }
    default:
      return state
  }
}

// --- Component ---

interface SlotStackProps {
  activeKey: string
  keys: string[]
  renderItem: (key: string) => ReactNode
  className?: string
  style?: React.CSSProperties
}

export function SlotStack({ activeKey, keys, renderItem, className = "", style: outerStyle }: SlotStackProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollState, dispatch] = useReducer(scrollReducer, { status: "initial" })
  const prevKeyRef = useRef(activeKey)

  const activeIdx = keys.indexOf(activeKey)
  const safeIdx = activeIdx >= 0 ? activeIdx : 0
  const safeIdxRef = useRef(safeIdx)
  safeIdxRef.current = safeIdx

  // Keep scrollState accessible to ResizeObserver without re-subscribing
  const scrollStateRef = useRef(scrollState)
  scrollStateRef.current = scrollState

  // Set initial scroll position synchronously via ref callback (before first paint).
  // Only transition to "idle" (which makes the container visible) if clientHeight > 0,
  // otherwise the scroll position is wrong and the ResizeObserver will correct it.
  const setRef = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el
    if (el && scrollStateRef.current.status === "initial") {
      el.scrollTop = safeIdxRef.current * el.clientHeight
      if (el.clientHeight > 0) {
        dispatch({ type: "INITIALIZED" })
      }
    }
  }, [])

  // On resize, instantly reposition — but only when idle (don't fight animations).
  // Also handles deferred initialization when clientHeight was 0 at ref callback time.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const status = scrollStateRef.current.status
      if (status === "initial" && el.clientHeight > 0) {
        el.scrollTop = safeIdxRef.current * el.clientHeight
        dispatch({ type: "INITIALIZED" })
      } else if (status === "idle") {
        el.scrollTop = safeIdxRef.current * el.clientHeight
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // When activeIdx changes due to keys array reordering (e.g. recent tab inserted)
  // but activeKey stays the same, instantly reposition before paint.
  const prevIdxRef = useRef(activeIdx)
  const prevKeyForIdxRef = useRef(activeKey)
  useLayoutEffect(() => {
    const keyChanged = activeKey !== prevKeyForIdxRef.current
    if (!keyChanged && activeIdx >= 0 && activeIdx !== prevIdxRef.current) {
      const el = scrollRef.current
      if (el) el.scrollTop = activeIdx * el.clientHeight
    }
    prevIdxRef.current = activeIdx
    prevKeyForIdxRef.current = activeKey
  }, [activeIdx, activeKey])

  // Start scroll when activeKey changes — snap instantly (no animation between tabs)
  useEffect(() => {
    if (activeKey === prevKeyRef.current) return
    prevKeyRef.current = activeKey

    const el = scrollRef.current
    if (!el) return

    const to = safeIdx * el.clientHeight
    const from = el.scrollTop
    if (Math.abs(to - from) < 1) return

    // Snap instantly — tab switches should be immediate (no scroll animation between slots)
    el.scrollTop = to
    return
  }, [activeKey, safeIdx])

  // Drive the RAF loop when animating
  useEffect(() => {
    if (scrollState.status !== "animating") return
    const el = scrollRef.current
    if (!el) return

    const { from, to, startTime } = scrollState
    const delta = to - from
    let raf: number

    const step = (now: number) => {
      const t = Math.min((now - startTime) / TAB_SCROLL_DURATION, 1)
      el.scrollTop = from + delta * cubicBezier(t)
      if (t < 1) {
        raf = requestAnimationFrame(step)
      } else {
        dispatch({ type: "COMPLETE" })
      }
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [scrollState])

  // On the very first render, only mount the active tab's slot so the browser's
  // scroll restoration can't show a different tab. After initialization, mount all
  // slots so tab-switch animations work normally.
  const allMounted = scrollState.status !== "initial"

  return (
    <div
      ref={setRef}
      className={className}
      style={{
        height: "100%",
        overflow: "hidden",
        ...outerStyle,
      }}
    >
      {keys.map((key) => (
        allMounted || key === activeKey ? (
          <MemoizedSlot
            key={key}
            tabKey={key}
            activeKey={activeKey}
            renderItem={renderItem}
          />
        ) : (
          <div key={key} className="h-full shrink-0" />
        )
      ))}
    </div>
  )
}

// --- Memoized slot wrapper (prevents non-active tabs from re-rendering) ---

interface MemoizedSlotProps {
  tabKey: string
  activeKey: string
  renderItem: (key: string) => ReactNode
}

const MemoizedSlot = memo(function MemoizedSlot({ tabKey, renderItem }: MemoizedSlotProps) {
  return (
    <div className="h-full shrink-0">
      {renderItem(tabKey)}
    </div>
  )
}, (prev, next) => {
  const wasActive = prev.tabKey === prev.activeKey
  const isActive = next.tabKey === next.activeKey
  return prev.tabKey === next.tabKey && wasActive === isActive
})
