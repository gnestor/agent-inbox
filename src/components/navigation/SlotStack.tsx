/**
 * SlotStack — vertical scroll container for tab transitions.
 *
 * Uses native scrollTop positioning instead of CSS transform. This means
 * resize is handled correctly — scrollTop = idx * clientHeight is always
 * accurate, unlike translateY(pixels) which goes stale for a frame.
 *
 * Tab switch: scrollTo({ behavior: 'smooth' }) for native animation.
 * Resize: instant scrollTop repositioning via ResizeObserver.
 * Initial: scrollTop set synchronously in ref callback (before first paint).
 */
import { useRef, useEffect, useCallback, memo, type ReactNode } from "react"
import { EASE } from "@/lib/navigation-constants"

/** Fixed duration for tab scroll transitions (ms) */
const TAB_SCROLL_DURATION = 1000

/** Evaluate cubic-bezier(EASE) at progress t ∈ [0,1] using binary search */
function cubicBezier(t: number): number {
  const [x1, y1, x2, y2] = EASE
  // Find the bezier parameter u where x(u) ≈ t
  let lo = 0, hi = 1
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2
    const x = 3 * x1 * mid * (1 - mid) ** 2 + 3 * x2 * mid ** 2 * (1 - mid) + mid ** 3
    if (x < t) lo = mid; else hi = mid
  }
  const u = (lo + hi) / 2
  return 3 * y1 * u * (1 - u) ** 2 + 3 * y2 * u ** 2 * (1 - u) + u ** 3
}

interface SlotStackProps {
  /** Key of the active item */
  activeKey: string
  /** Ordered list of all possible keys */
  keys: string[]
  /** Render function for a given key */
  renderItem: (key: string) => ReactNode
  /** Additional className on the outer wrapper */
  className?: string
  /** Additional inline styles on the outer wrapper */
  style?: React.CSSProperties
}

export function SlotStack({ activeKey, keys, renderItem, className = "", style: outerStyle }: SlotStackProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const isFirstRender = useRef(true)
  const prevKeyRef = useRef(activeKey)

  const activeIdx = keys.indexOf(activeKey)
  const safeIdx = activeIdx >= 0 ? activeIdx : 0
  const safeIdxRef = useRef(safeIdx)
  safeIdxRef.current = safeIdx

  // Set initial scroll position synchronously via ref callback (before first paint)
  const setRef = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el
    if (el && isFirstRender.current) {
      el.scrollTop = safeIdxRef.current * el.clientHeight
      isFirstRender.current = false
    }
  }, [])

  // On resize, instantly reposition to the active tab (no animation).
  // Uses a ref for safeIdx so the ResizeObserver always reads the latest value.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (!isFirstRender.current) {
        el.scrollTop = safeIdxRef.current * el.clientHeight
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Animate scroll to the active tab when activeKey changes.
  // Always takes TAB_SCROLL_DURATION ms regardless of distance, so crossing
  // multiple tabs scrolls faster per-tab than crossing one.
  useEffect(() => {
    if (activeKey === prevKeyRef.current) return
    prevKeyRef.current = activeKey

    const el = scrollRef.current
    if (!el) return

    const target = safeIdx * el.clientHeight
    const start = el.scrollTop
    const delta = target - start
    if (Math.abs(delta) < 1) return

    const startTime = performance.now()
    let raf: number

    const step = (now: number) => {
      const t = Math.min((now - startTime) / TAB_SCROLL_DURATION, 1)
      el.scrollTop = start + delta * cubicBezier(t)
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [activeKey, safeIdx])

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
  // Re-render only when this slot becomes/stops being active
  const wasActive = prev.tabKey === prev.activeKey
  const isActive = next.tabKey === next.activeKey
  return prev.tabKey === next.tabKey && wasActive === isActive
})
