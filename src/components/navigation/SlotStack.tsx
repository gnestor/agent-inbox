/**
 * SlotStack — vertical scroll-snap container for tab switching.
 *
 * Tabs are full-height slots with CSS scroll-snap. The active tab is driven
 * by the `activeKey` prop (from URL/navigation state). A scroll listener
 * tracks which tab is most visible on every frame and fires
 * `onActiveKeyChange` to sync the URL and sidebar instantly.
 */
import { useRef, useEffect, useCallback, useState, memo, type ReactNode, type RefObject } from "react"
import { useIsMobile } from "@hammies/frontend/hooks"

interface SlotStackProps {
  activeKey: string
  keys: string[]
  renderItem: (key: string) => ReactNode
  onActiveKeyChange?: (key: string) => void
  className?: string
  style?: React.CSSProperties
}

/**
 * LazySlot — mounts content when the slot enters the scroll container's
 * extended viewport (via IntersectionObserver with rootMargin). The active
 * tab renders immediately; neighbors pre-render when within 1 viewport
 * height of the visible area. Once mounted, content stays mounted.
 */
const LazySlot = memo(function LazySlot({
  tabKey,
  isActive,
  renderItem,
  scrollRoot,
}: {
  tabKey: string
  isActive: boolean
  renderItem: (key: string) => ReactNode
  scrollRoot: RefObject<HTMLDivElement | null>
}) {
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(isActive)

  // Active tab mounts synchronously (no flash)
  if (isActive && !mounted) setMounted(true)

  useEffect(() => {
    if (mounted) return
    const el = sentinelRef.current
    const root = scrollRoot.current
    if (!el || !root) return

    const observer = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) setMounted(true) },
      { root, rootMargin: "100%" },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [mounted, scrollRoot])

  if (!mounted) return <div ref={sentinelRef} />

  return <>{renderItem(tabKey)}</>
})

export function SlotStack({ activeKey, keys, renderItem, onActiveKeyChange, className = "", style: outerStyle }: SlotStackProps) {
  const isMobile = useIsMobile()
  const scrollRef = useRef<HTMLDivElement>(null)
  const isProgrammaticScroll = useRef(false)

  const activeIdx = keys.indexOf(activeKey)
  const safeIdx = activeIdx >= 0 ? activeIdx : 0
  const safeIdxRef = useRef(safeIdx)
  safeIdxRef.current = safeIdx

  // Scroll to active tab when activeKey changes from sidebar click.
  const isUserScrolling = useRef(false)
  const prevActiveKey = useRef(activeKey)
  const prevKeysLenRef = useRef(keys.length)
  useEffect(() => {
    const keysChanged = prevKeysLenRef.current !== keys.length
    prevKeysLenRef.current = keys.length

    if (prevActiveKey.current === activeKey && !keysChanged) return
    prevActiveKey.current = activeKey

    if (isUserScrolling.current) {
      isUserScrolling.current = false
      return
    }

    const el = scrollRef.current
    if (!el || el.clientHeight === 0) return

    const idx = keys.indexOf(activeKey)
    if (idx < 0) return
    const target = idx * el.clientHeight
    if (Math.abs(el.scrollTop - target) < 1) return

    // Use instant scroll when keys changed (tab inserted/removed) to avoid
    // the glitch of smooth-scrolling through shifted positions.
    isProgrammaticScroll.current = true
    el.style.scrollSnapType = "none"
    if (keysChanged) {
      el.scrollTop = target
      requestAnimationFrame(() => {
        el.style.scrollSnapType = "y mandatory"
        isProgrammaticScroll.current = false
      })
    } else {
      el.scrollTo({ top: target, behavior: "smooth" })
      const onEnd = () => {
        el.style.scrollSnapType = "y mandatory"
        isProgrammaticScroll.current = false
        el.removeEventListener("scrollend", onEnd)
      }
      el.addEventListener("scrollend", onEnd, { once: true })
      setTimeout(() => {
        el.style.scrollSnapType = "y mandatory"
        isProgrammaticScroll.current = false
      }, 1000)
    }
  })

  // Track which tab is most visible on every scroll event
  const activeKeyRef = useRef(activeKey)
  activeKeyRef.current = activeKey
  const onActiveKeyChangeRef = useRef(onActiveKeyChange)
  onActiveKeyChangeRef.current = onActiveKeyChange
  const keysRef = useRef(keys)
  keysRef.current = keys

  useEffect(() => {
    if (isMobile) return
    const el = scrollRef.current
    if (!el) return

    // Fire onActiveKeyChange synchronously during scroll so the sidebar
    // highlights instantly. With Zustand selectors, switchTab only re-renders
    // activeTab subscribers (~4 components), so this is cheap.
    const onScroll = () => {
      if (isProgrammaticScroll.current) return
      const height = el.clientHeight
      if (height === 0) return
      const idx = Math.round(el.scrollTop / height)
      const key = keysRef.current[idx]
      if (key && key !== activeKeyRef.current) {
        isUserScrolling.current = true
        activeKeyRef.current = key
        onActiveKeyChangeRef.current?.(key)
      }
    }

    el.addEventListener("scroll", onScroll, { passive: true })
    return () => el.removeEventListener("scroll", onScroll)
  }, [isMobile])

  // Set initial scroll position synchronously
  const setRef = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el
    if (el && el.clientHeight > 0) {
      el.style.scrollSnapType = "none"
      el.scrollTop = safeIdx * el.clientHeight
      requestAnimationFrame(() => { el.style.scrollSnapType = "y mandatory" })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reposition on resize (subscribe once, read safeIdx from ref)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (el.clientHeight > 0 && !isUserScrolling.current) {
        el.style.scrollSnapType = "none"
        el.scrollTop = safeIdxRef.current * el.clientHeight
        requestAnimationFrame(() => { el.style.scrollSnapType = "y mandatory" })
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Mobile: render only the active tab with a vertical slide transition
  const prevKeyRef = useRef(activeKey)
  const [slideDir, setSlideDir] = useState<"none" | "up" | "down">("none")

  useEffect(() => {
    if (!isMobile) return
    if (prevKeyRef.current === activeKey) return
    const prevIdx = keys.indexOf(prevKeyRef.current)
    const nextIdx = keys.indexOf(activeKey)
    prevKeyRef.current = activeKey
    if (prevIdx < 0 || nextIdx < 0) return
    setSlideDir(nextIdx > prevIdx ? "up" : "down")
    const timer = setTimeout(() => setSlideDir("none"), 250)
    return () => clearTimeout(timer)
  }, [isMobile, activeKey, keys])

  if (isMobile) {
    return (
      <div
        className={className}
        style={{
          height: "100%",
          overflow: "hidden",
          ...outerStyle,
        }}
      >
        <div
          key={activeKey}
          style={{
            height: "100%",
            animation: slideDir !== "none"
              ? `slide-${slideDir} 200ms ease-out`
              : undefined,
          }}
        >
          {renderItem(activeKey)}
        </div>
        <style>{`
          @keyframes slide-up {
            from { transform: translateY(40px); opacity: 0.7; }
            to { transform: translateY(0); opacity: 1; }
          }
          @keyframes slide-down {
            from { transform: translateY(-40px); opacity: 0.7; }
            to { transform: translateY(0); opacity: 1; }
          }
        `}</style>
      </div>
    )
  }

  // Desktop: vertical scroll-snap for tab switching.
  return (
    <div
      ref={setRef}
      className={className}
      style={{
        height: "100%",
        overflowY: "scroll",
        scrollSnapType: "y mandatory",
        scrollbarWidth: "none",
        ...outerStyle,
      }}
    >
      {keys.map((key) => (
        <div
          key={key}
          className="h-full shrink-0"
          style={{ scrollSnapAlign: "start" }}
        >
          <LazySlot
            tabKey={key}
            isActive={key === activeKey}
            renderItem={renderItem}
            scrollRoot={scrollRef}
          />
        </div>
      ))}
    </div>
  )
}
