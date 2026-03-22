/**
 * SlotStack — vertical scroll container for tab transitions.
 *
 * Uses native scrollTop positioning with an explicit animation state machine.
 * The reducer makes the scroll state visible and prevents the ResizeObserver
 * from fighting an in-progress animation.
 */
import { useRef, useEffect, useReducer, useCallback, memo, type ReactNode } from "react"
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

  // Set initial scroll position synchronously via ref callback (before first paint)
  const setRef = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el
    if (el && scrollStateRef.current.status === "initial") {
      el.scrollTop = safeIdxRef.current * el.clientHeight
      dispatch({ type: "INITIALIZED" })
    }
  }, [])

  // On resize, instantly reposition — but only when idle (don't fight animations)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (scrollStateRef.current.status === "idle") {
        el.scrollTop = safeIdxRef.current * el.clientHeight
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Start animation when activeKey changes
  useEffect(() => {
    if (activeKey === prevKeyRef.current) return
    prevKeyRef.current = activeKey

    const el = scrollRef.current
    if (!el) return

    const to = safeIdx * el.clientHeight
    const from = el.scrollTop
    if (Math.abs(to - from) < 1) return

    dispatch({ type: "ANIMATE", from, to })
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
        <MemoizedSlot
          key={key}
          tabKey={key}
          activeKey={activeKey}
          renderItem={renderItem}
        />
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
    <div style={{ height: "100%", flexShrink: 0 }}>
      {renderItem(tabKey)}
    </div>
  )
}, (prev, next) => {
  const wasActive = prev.tabKey === prev.activeKey
  const isActive = next.tabKey === next.activeKey
  return prev.tabKey === next.tabKey && wasActive === isActive
})
