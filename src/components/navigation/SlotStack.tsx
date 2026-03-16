/**
 * SlotStack — unified vertical transition container.
 *
 * Two modes:
 * - keepAll: all items stay mounted (tabs)
 * - keepPrevious: only active + previous mounted during transition,
 *   previous unmounted after transition completes (detail panels)
 */
import { useRef, useEffect, useState, type ReactNode } from "react"
import { DURATION } from "@/lib/navigation-constants"

const GAP = 16

interface SlotStackProps {
  /** Key of the active item */
  activeKey: string
  /** Ordered list of all possible keys (required for keepAll mode) */
  keys?: string[]
  /** Render function for a given key */
  renderItem: (key: string) => ReactNode
  /** Keep all items mounted vs only active + previous */
  mode?: "keepAll" | "keepPrevious"
  /** Direction hint for keepPrevious: 1 = new item is below, -1 = above */
  direction?: number
  /** Width of the container (for detail panels). Omit for full-width (tabs). */
  width?: number
  /** Additional className on the outer wrapper */
  className?: string
}

export function SlotStack({
  activeKey,
  keys,
  renderItem,
  mode = "keepPrevious",
  direction = 1,
  width,
  className = "",
}: SlotStackProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)
  const [settled, setSettled] = useState(false)

  // For keepPrevious: track the items array and which index is active
  const prevKeyRef = useRef(activeKey)
  const [items, setItems] = useState<string[]>(() => {
    if (mode === "keepAll" && keys) return keys
    return [activeKey]
  })
  // Track the active index explicitly to avoid jump when prev is removed
  const [activeIdx, setActiveIdx] = useState(0)
  // Disable transition when cleaning up previous item
  const [transitionEnabled, setTransitionEnabled] = useState(true)

  // Measure container
  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    setHeight(el.clientHeight)
    const ro = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Enable transition after first paint
  useEffect(() => {
    requestAnimationFrame(() => setSettled(true))
  }, [])

  // Update items when activeKey changes
  useEffect(() => {
    if (mode === "keepAll") {
      if (keys) {
        setItems(keys)
        const idx = keys.indexOf(activeKey)
        setActiveIdx(idx >= 0 ? idx : 0)
      }
      return
    }

    // keepPrevious mode
    if (activeKey === prevKeyRef.current) return

    const prev = prevKeyRef.current
    prevKeyRef.current = activeKey
    setTransitionEnabled(false) // snap to starting position without animation

    // Order items based on direction.
    // The trick: place items in visual order, start showing the OLD item,
    // then transition to show the NEW item.
    if (direction >= 0) {
      // Scrolling down: [prev, active]. Start at 0 (prev), animate to 1 (active).
      setItems([prev, activeKey])
      // Start at prev's position (0), then animate to active (1) on next frame
      setActiveIdx(0)
      requestAnimationFrame(() => {
        setTransitionEnabled(true)
        setActiveIdx(1)
      })
    } else {
      // Scrolling up: [active, prev]. Start at 1 (prev), animate to 0 (active).
      setItems([activeKey, prev])
      setActiveIdx(1)
      requestAnimationFrame(() => {
        setTransitionEnabled(true)
        setActiveIdx(0)
      })
    }

    // After transition: remove prev, snap to index 0 without animation
    const timer = setTimeout(() => {
      setTransitionEnabled(false) // disable transition for the cleanup
      setItems([activeKey])
      setActiveIdx(0)
      // Re-enable transition on next frame
      requestAnimationFrame(() => setTransitionEnabled(true))
    }, DURATION * 1000 + 50)

    return () => clearTimeout(timer)
  }, [activeKey, mode, keys, direction]) // eslint-disable-line react-hooks/exhaustive-deps

  const offset = height > 0 ? -(activeIdx * (height + GAP)) : 0

  return (
    <div
      ref={wrapperRef}
      className={`overflow-hidden ${className}`}
      style={{
        height: "100%",
        width,
        flexShrink: width ? 0 : undefined,
      }}
    >
      <div
        style={{
          transform: `translateY(${offset}px)`,
          transition: settled && height > 0 && transitionEnabled
            ? `transform ${DURATION}s cubic-bezier(0.32, 0.72, 0, 1)`
            : "none",
          display: "flex",
          flexDirection: "column",
          gap: GAP,
        }}
      >
        {items.map((key) => (
          <div key={key} style={{ height: height || undefined, flexShrink: 0 }}>
            {renderItem(key)}
          </div>
        ))}
      </div>
    </div>
  )
}
