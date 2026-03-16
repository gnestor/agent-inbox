/**
 * SlotStack — unified vertical transition container.
 *
 * Desktop: CSS transform with transition (programmatic).
 * Mobile: native scroll with scroll-snap (touch-driven).
 *
 * Two modes:
 * - keepAll: all items stay mounted (tabs)
 * - keepPrevious: only active + previous mounted during transition,
 *   previous unmounted after transition completes (detail panels)
 */
import { useRef, useEffect, useState, useCallback, type ReactNode } from "react"
import { useIsMobile } from "@hammies/frontend/hooks"
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
  /** Called when user scrolls to a different item (mobile snap) */
  onSnapChange?: (key: string) => void
}

export function SlotStack(props: SlotStackProps) {
  const isMobile = useIsMobile()

  // Mobile keepAll: use scroll-snap for direct touch scrolling
  if (isMobile && props.mode === "keepAll" && props.keys) {
    return <ScrollSnapStack {...props} keys={props.keys} />
  }

  // Desktop (all modes) + mobile keepPrevious: use CSS transform
  return <TransformStack {...props} />
}

// --- Scroll-snap version (mobile, keepAll) ---

function ScrollSnapStack({
  activeKey,
  keys,
  renderItem,
  className = "",
  onSnapChange,
}: SlotStackProps & { keys: string[] }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const isFirstRender = useRef(true)
  const isProgrammatic = useRef(false)

  const activeIndex = keys.indexOf(activeKey)
  const safeIndex = activeIndex >= 0 ? activeIndex : 0

  // Set initial scroll position synchronously via ref callback
  const setScrollRef = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el
    if (el && isFirstRender.current) {
      // Instant scroll to active tab before first paint
      const targetTop = safeIndex * el.clientHeight
      el.scrollTop = targetTop
      isFirstRender.current = false
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to active item when it changes programmatically (e.g., sidebar tap)
  useEffect(() => {
    if (isFirstRender.current) return // handled by ref callback above
    const el = scrollRef.current
    if (!el) return

    const slot = el.children[safeIndex] as HTMLElement
    if (!slot) return

    isProgrammatic.current = true
    slot.scrollIntoView({ behavior: "smooth", block: "start" })

    // Reset programmatic flag after scroll completes
    const timer = setTimeout(() => { isProgrammatic.current = false }, DURATION * 1000 + 100)
    return () => clearTimeout(timer)
  }, [safeIndex])

  // Detect user-initiated scroll-snap and notify parent
  const handleScroll = useCallback(() => {
    if (isProgrammatic.current || isFirstRender.current || !onSnapChange || !scrollRef.current) return

    const el = scrollRef.current
    const scrollTop = el.scrollTop
    const slotHeight = el.clientHeight

    // Find which slot is closest to the current scroll position
    const snappedIndex = Math.round(scrollTop / (slotHeight + GAP))
    const clampedIndex = Math.max(0, Math.min(snappedIndex, keys.length - 1))
    const snappedKey = keys[clampedIndex]

    if (snappedKey && snappedKey !== activeKey) {
      onSnapChange(snappedKey)
    }
  }, [activeKey, keys, onSnapChange])

  // Debounce scroll events to detect snap completion
  const scrollTimer = useRef<ReturnType<typeof setTimeout>>()
  const onScroll = useCallback(() => {
    clearTimeout(scrollTimer.current)
    scrollTimer.current = setTimeout(handleScroll, 100)
  }, [handleScroll])

  return (
    <div
      ref={setScrollRef}
      className={`${className}`}
      onScroll={onScroll}
      style={{
        height: "100%",
        overflowY: "scroll",
        scrollSnapType: "y mandatory",
        scrollbarWidth: "none",
        msOverflowStyle: "none",
        WebkitOverflowScrolling: "touch",
      }}
    >
      {/* Hide scrollbar for webkit */}
      <style>{`.slot-stack-scroll::-webkit-scrollbar { display: none; }`}</style>
      {keys.map((key) => (
        <div
          key={key}
          style={{
            height: "100%",
            flexShrink: 0,
            scrollSnapAlign: "start",
            scrollSnapStop: "always",
          }}
        >
          {renderItem(key)}
        </div>
      ))}
    </div>
  )
}

// --- CSS transform version (desktop + mobile keepPrevious) ---

function TransformStack({
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

  const prevKeyRef = useRef(activeKey)
  const [items, setItems] = useState<string[]>(() => {
    if (mode === "keepAll" && keys) return keys
    return [activeKey]
  })
  const [activeIdx, setActiveIdx] = useState(0)
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
    setTransitionEnabled(false)

    if (direction >= 0) {
      setItems([prev, activeKey])
      setActiveIdx(0)
      requestAnimationFrame(() => {
        setTransitionEnabled(true)
        setActiveIdx(1)
      })
    } else {
      setItems([activeKey, prev])
      setActiveIdx(1)
      requestAnimationFrame(() => {
        setTransitionEnabled(true)
        setActiveIdx(0)
      })
    }

    const timer = setTimeout(() => {
      setTransitionEnabled(false)
      setItems([activeKey])
      setActiveIdx(0)
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
