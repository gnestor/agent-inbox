/**
 * SlotStack — vertical CSS transform container for tab transitions.
 *
 * All items stay mounted (keepAll). The active item is brought into view
 * via translateY with a CSS transition. Non-active items are memoized
 * to prevent unnecessary re-renders.
 */
import { useRef, useEffect, useState, memo, type ReactNode } from "react"
import { DURATION } from "@/lib/navigation-constants"

const GAP = 16

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
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)
  const [animating, setAnimating] = useState(false)
  const prevKeyRef = useRef(activeKey)

  // Measure container height
  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    setHeight(el.clientHeight)
    const ro = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Enable transition only when activeKey changes (not on resize)
  useEffect(() => {
    if (activeKey === prevKeyRef.current) return
    prevKeyRef.current = activeKey
    setAnimating(true)
    const timer = setTimeout(() => setAnimating(false), DURATION * 1000 + 50)
    return () => clearTimeout(timer)
  }, [activeKey])

  const activeIdx = keys.indexOf(activeKey)
  const safeIdx = activeIdx >= 0 ? activeIdx : 0
  const offset = height > 0 ? -(safeIdx * (height + GAP)) : 0

  return (
    <div
      ref={wrapperRef}
      className={className}
      style={{
        height: "100%",
        overflow: "hidden",
        visibility: height > 0 ? "visible" : "hidden",
        ...outerStyle,
      }}
    >
      <div
        style={{
          transform: `translateY(${offset}px)`,
          transition: animating
            ? `transform ${DURATION}s cubic-bezier(0.32, 0.72, 0, 1)`
            : "none",
          display: "flex",
          flexDirection: "column",
          gap: GAP,
        }}
      >
        {keys.map((key) => (
          <MemoizedSlot
            key={key}
            tabKey={key}
            activeKey={activeKey}
            renderItem={renderItem}
            height={height}
          />
        ))}
      </div>
    </div>
  )
}

// --- Memoized slot wrapper (prevents non-active tabs from re-rendering) ---

interface MemoizedSlotProps {
  tabKey: string
  activeKey: string
  renderItem: (key: string) => ReactNode
  height: number
}

const MemoizedSlot = memo(function MemoizedSlot({ tabKey, renderItem, height }: MemoizedSlotProps) {
  return (
    <div style={{ height: height || undefined, flexShrink: 0 }}>
      {renderItem(tabKey)}
    </div>
  )
}, (prev, next) => {
  // Re-render only when this slot becomes/stops being active, or height changes
  const wasActive = prev.tabKey === prev.activeKey
  const isActive = next.tabKey === next.activeKey
  return prev.tabKey === next.tabKey
    && prev.height === next.height
    && wasActive === isActive
})
