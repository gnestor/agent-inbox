/**
 * SlotStack — vertical scroll-snap container for tab switching.
 *
 * Tabs are full-height slots with CSS scroll-snap. The active tab is driven
 * by the `activeKey` prop (from URL/navigation state). A scroll listener
 * tracks which tab is most visible on every frame and fires
 * `onActiveKeyChange` to sync the URL and sidebar instantly.
 */
import { useRef, useEffect, useCallback, type ReactNode } from "react"
import { useIsMobile } from "@hammies/frontend/hooks"
import { ACTIVE_TAB_CLASS_LIST } from "@/lib/navigation-constants"

interface SlotStackProps {
  activeKey: string
  keys: string[]
  renderItem: (key: string) => ReactNode
  onActiveKeyChange?: (key: string) => void
  className?: string
  style?: React.CSSProperties
}

export function SlotStack({ activeKey, keys, renderItem, onActiveKeyChange, className = "", style: outerStyle }: SlotStackProps) {
  const isMobile = useIsMobile()
  const scrollRef = useRef<HTMLDivElement>(null)
  const isProgrammaticScroll = useRef(false)
  const scrollSyncTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const activeIdx = keys.indexOf(activeKey)
  const safeIdx = activeIdx >= 0 ? activeIdx : 0
  const safeIdxRef = useRef(safeIdx)
  safeIdxRef.current = safeIdx

  // Scroll to active tab when activeKey changes from sidebar click.
  const isUserScrolling = useRef(false)
  const prevActiveKey = useRef(activeKey)
  useEffect(() => {
    if (prevActiveKey.current === activeKey) return
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

    isProgrammaticScroll.current = true
    el.style.scrollSnapType = "none"
    el.scrollTo({ top: target, behavior: "smooth" })
    // Re-enable snap and clear flag after scroll completes
    const onEnd = () => {
      el.style.scrollSnapType = "y mandatory"
      isProgrammaticScroll.current = false
      el.removeEventListener("scrollend", onEnd)
    }
    el.addEventListener("scrollend", onEnd, { once: true })
    // Fallback in case scrollend doesn't fire (e.g. already at target)
    setTimeout(() => {
      el.style.scrollSnapType = "y mandatory"
      isProgrammaticScroll.current = false
    }, 1000)
  })

  // Track which tab is most visible on every scroll event
  const activeKeyRef = useRef(activeKey)
  activeKeyRef.current = activeKey
  const onActiveKeyChangeRef = useRef(onActiveKeyChange)
  onActiveKeyChangeRef.current = onActiveKeyChange
  const keysRef = useRef(keys)
  keysRef.current = keys

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const onScroll = () => {
      if (isProgrammaticScroll.current) return
      const height = el.clientHeight
      if (height === 0) return
      const idx = Math.round(el.scrollTop / height)
      const key = keysRef.current[idx]
      if (key && key !== activeKeyRef.current) {
        isUserScrolling.current = true
        activeKeyRef.current = key
        // Update sidebar highlight instantly via DOM (bypass React)
        const primaryClasses = ACTIVE_TAB_CLASS_LIST
        document.querySelectorAll<HTMLElement>("[data-tab-id]").forEach((el) => {
          if (el.dataset.tabId === key) {
            el.setAttribute("data-active", "")
            el.classList.add(...primaryClasses)
          } else {
            el.removeAttribute("data-active")
            el.classList.remove(...primaryClasses)
          }
        })
        // Debounce the React state update (URL sync) to avoid blocking scroll
        clearTimeout(scrollSyncTimer.current)
        scrollSyncTimer.current = setTimeout(() => {
          onActiveKeyChangeRef.current?.(key)
        }, 150)
      }
    }

    el.addEventListener("scroll", onScroll, { passive: true })
    return () => el.removeEventListener("scroll", onScroll)
  }, [])

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

  // Mobile: no scroll-snap, just render the active tab
  if (isMobile) {
    return (
      <div className={className} style={{ height: "100%", overflow: "hidden", ...outerStyle }}>
        {renderItem(activeKey)}
      </div>
    )
  }

  // Desktop: vertical scroll-snap for tab switching
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
          {renderItem(key)}
        </div>
      ))}
    </div>
  )
}
