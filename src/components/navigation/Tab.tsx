// src/components/navigation/Tab.tsx
import {
  Children,
  useRef,
  useEffect,
  useLayoutEffect,
  useState,
  createContext,
  useContext,
  useCallback,
} from "react"
import { useIsMobile } from "@hammies/frontend/hooks"
import { useNavigation } from "@/hooks/use-navigation"
import type { TabId } from "@/types/navigation"
import { getTabOrder } from "@/types/navigation"
import { DURATION, EASE, EASE_CSS } from "@/lib/navigation-constants"

// --- JS-driven smooth scroll (replaces browser's scrollTo smooth) ---

/** Evaluate a cubic-bezier curve at parameter t. */
function cubicBezier(t: number, _x1: number, y1: number, _x2: number, y2: number): number {
  // De Casteljau's algorithm for cubic bezier with control points (0,0), (x1,y1), (x2,y2), (1,1)
  const u = 1 - t
  return 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t
}

/** Find the t parameter for a given x value on the bezier curve (Newton's method). */
function bezierT(x: number, x1: number, x2: number): number {
  let t = x
  for (let i = 0; i < 8; i++) {
    const u = 1 - t
    const currentX = 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t
    const dx = currentX - x
    if (Math.abs(dx) < 1e-6) break
    const slope = 3 * u * u * x1 + 6 * u * t * (x2 - x1) + 3 * t * t * (1 - x2)
    if (Math.abs(slope) < 1e-6) break
    t -= dx / slope
  }
  return t
}

/** Animate scrollLeft from current position to target using the app's easing curve. */
function animateScroll(
  el: HTMLElement,
  target: number,
  durationMs: number,
  onDone: () => void,
): () => void {
  const start = el.scrollLeft
  const delta = target - start
  if (Math.abs(delta) < 1) { onDone(); return () => {} }
  const startTime = performance.now()
  let cancelled = false

  function tick(now: number) {
    if (cancelled) return
    const elapsed = now - startTime
    const progress = Math.min(elapsed / durationMs, 1)
    // Map progress through the cubic-bezier easing
    const t = bezierT(progress, EASE[0], EASE[2])
    const eased = cubicBezier(t, EASE[0], EASE[1], EASE[2], EASE[3])
    el.scrollLeft = start + delta * eased
    if (progress < 1) {
      requestAnimationFrame(tick)
    } else {
      el.scrollLeft = target // ensure exact final position
      onDone()
    }
  }
  requestAnimationFrame(tick)
  return () => { cancelled = true }
}

interface TabProps {
  id: TabId
  children: React.ReactNode
}

// --- Vertical drag context (for PanelHeader to switch tabs on mobile) ---

interface DragTabContextValue {
  onVerticalDrag: (startY: number, e: PointerEvent) => void
}

export const DragTabContext = createContext<DragTabContextValue | null>(null)

export function useDragTab() {
  return useContext(DragTabContext)
}

// --- Exit children helper (keeps outgoing panels in DOM during exit animation) ---

function useExitChildren(
  children: React.ReactNode,
  targetPanelIndex: number,
  hasMounted: React.RefObject<boolean>,
  transition: "item" | "none",
) {
  const prevChildrenRef = useRef<React.ReactNode>(children)
  const prevTargetRef = useRef(targetPanelIndex)
  const [exitChildren, setExitChildren] = useState<React.ReactNode>(null)

  // Only collapse panels for push/pop transitions. Item selection transitions
  // are handled by PanelSlot's vertical slide — the whole panel group moves as a unit.
  if (targetPanelIndex < prevTargetRef.current && hasMounted.current && transition !== "item") {
    if (!exitChildren) {
      setExitChildren(prevChildrenRef.current)
    }
  }
  prevChildrenRef.current = children
  prevTargetRef.current = targetPanelIndex

  const clearExit = useCallback(() => setExitChildren(null), [])
  return { renderedChildren: exitChildren ?? children, exitChildren, clearExit }
}

// --- MobileTab (fullscreen panels, scroll-snap, touch navigation) ---

function MobileTab({ id, children }: TabProps) {
  const { activeTab, getSelectedItemId, getPanels, getPanelTransition, switchTab, deselectItem } = useNavigation()
  const scrollRef = useRef<HTMLDivElement>(null)
  const isActive = activeTab === id
  const [snapEnabled, setSnapEnabled] = useState(false)
  const hasMounted = useRef(false)
  const isProgrammaticScroll = useRef(false)
  const cancelScrollRef = useRef<(() => void) | null>(null)

  const panels = getPanels(id)
  void getSelectedItemId(id) // trigger re-render on selection change
  const targetPanelIndex = panels.length > 1 ? panels.length - 1 : 0

  const { renderedChildren, exitChildren, clearExit } = useExitChildren(
    children,
    targetPanelIndex,
    hasMounted,
    getPanelTransition(id),
  )

  // Scroll to the correct panel on every render
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !isActive) return

    const panelWidth = el.clientWidth
    if (panelWidth === 0) return
    const target = targetPanelIndex * panelWidth

    // Already at correct position
    if (Math.abs(el.scrollLeft - target) < 2) {
      if (!snapEnabled) setSnapEnabled(true)
      if (!hasMounted.current) hasMounted.current = true
      if (exitChildren && target === 0) clearExit()
      return
    }

    const smooth = hasMounted.current

    const doScroll = () => {
      isProgrammaticScroll.current = true
      el.style.scrollSnapType = "none"
      if (smooth) {
        // JS-driven animation instead of browser smooth scroll — gives us
        // full control over the easing curve and guarantees pixel-perfect
        // landing without the snap correction jump at the end.
        cancelScrollRef.current = animateScroll(el, target, DURATION * 1000, () => {
          el.style.scrollSnapType = "x mandatory"
          setSnapEnabled(true)
          isProgrammaticScroll.current = false
          if (exitChildren) clearExit()
        })
      } else {
        el.scrollLeft = target
        requestAnimationFrame(() => {
          el.style.scrollSnapType = "x mandatory"
          setSnapEnabled(true)
          isProgrammaticScroll.current = false
        })
      }
      hasMounted.current = true
    }

    // Wait for panel to be laid out if not yet wide enough to scroll.
    // Double-rAF covers browsers with a two-frame layout pipeline.
    if (el.scrollWidth <= el.clientWidth && target > 0) {
      const raf = requestAnimationFrame(() => {
        if (el.scrollWidth > el.clientWidth) { doScroll(); return }
        requestAnimationFrame(() => {
          if (el.scrollWidth > el.clientWidth) doScroll()
        })
      })
      return () => cancelAnimationFrame(raf)
    }

    doScroll()
  })

  // Deselect item when user swipes back to list panel.
  // Uses a timeout after scroll settles to avoid iOS Safari issues with
  // scrollend firing prematurely during programmatic smooth scrolls.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let scrollTimer: ReturnType<typeof setTimeout> | undefined
    const onScroll = () => {
      if (isProgrammaticScroll.current) return
      clearTimeout(scrollTimer)
      scrollTimer = setTimeout(() => {
        if (isProgrammaticScroll.current) return
        if (el.scrollLeft < el.clientWidth * 0.5 && panels.length > 1) {
          deselectItem()
        }
      }, 150)
    }
    el.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      el.removeEventListener("scroll", onScroll)
      clearTimeout(scrollTimer)
    }
  }, [panels.length, deselectItem])

  // Vertical drag to switch tabs
  const onVerticalDrag = useCallback(
    (startY: number, firstMove: PointerEvent) => {
      const threshold = 60
      const tabs = getTabOrder()
      const currentIdx = tabs.indexOf(id)

      const trySwitch = (me: PointerEvent) => {
        const dy = me.clientY - startY
        if (Math.abs(dy) > threshold) {
          const nextIdx =
            dy < 0 ? Math.min(currentIdx + 1, tabs.length - 1) : Math.max(currentIdx - 1, 0)
          if (nextIdx !== currentIdx) switchTab(tabs[nextIdx]!)
          document.removeEventListener("pointermove", onMove)
          document.removeEventListener("pointerup", onUp)
        }
      }
      const onMove = (me: PointerEvent) => trySwitch(me)
      const onUp = () => {
        document.removeEventListener("pointermove", onMove)
        document.removeEventListener("pointerup", onUp)
      }
      document.addEventListener("pointermove", onMove)
      document.addEventListener("pointerup", onUp)
      trySwitch(firstMove)
    },
    [id, switchTab],
  )

  return (
    <DragTabContext.Provider value={{ onVerticalDrag }}>
      <div
        ref={scrollRef}
        className="flex flex-row h-full shrink-0 overflow-y-hidden overflow-x-auto"
        style={{ scrollSnapType: snapEnabled ? "x mandatory" : "none" }}
      >
        {renderedChildren}
      </div>
    </DragTabContext.Provider>
  )
}

// --- DesktopTab (side-by-side panels, horizontal scroll) ---

function DesktopTab({ id, children }: TabProps) {
  const { activeTab, getPanels, getPanelTransition } = useNavigation()
  const scrollRef = useRef<HTMLDivElement>(null)
  const isActive = activeTab === id
  const prevPanelCountRef = useRef(0)
  const savedScrollRef = useRef(0)
  const hasMounted = useRef(false)

  const panels = getPanels(id)
  // Use direct children count (list + group), not total panels count.
  // Changes inside the PanelSlot group shouldn't trigger tab-level collapse.
  const childCount = Children.count(children)
  const targetPanelIndex = childCount > 1 ? childCount - 1 : 0
  const { renderedChildren, clearExit } = useExitChildren(
    children,
    targetPanelIndex,
    hasMounted,
    getPanelTransition(id),
  )

  // Save/restore scroll position when switching tabs
  useEffect(() => {
    if (isActive && scrollRef.current && !hasMounted.current) {
      scrollRef.current.scrollLeft = savedScrollRef.current
    }
    return () => {
      if (scrollRef.current) {
        savedScrollRef.current = scrollRef.current.scrollLeft
      }
    }
  }, [isActive])

  const panelCount = panels.length
  const mountedAt = useRef(performance.now())
  useEffect(() => { hasMounted.current = true }, [])

  // On first mount, start scrolled to the last panel
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || el.scrollWidth <= el.clientWidth) return
    el.scrollLeft = el.scrollWidth - el.clientWidth
  }, [])

  // Scroll when panels are added or removed inside the group
  useEffect(() => {
    if (!isActive || !scrollRef.current) return

    if (panelCount > prevPanelCountRef.current && prevPanelCountRef.current > 0) {
      requestAnimationFrame(() => {
        const el = scrollRef.current
        if (!el) return
        const target = el.scrollWidth - el.clientWidth
        // Snap instantly during initial settling (e.g. async persisted state load)
        const instant = !hasMounted.current || performance.now() - mountedAt.current < 1000
        el.scrollTo({ left: target, behavior: instant ? "instant" : "smooth" })
      })
    }
    // Panel removed: the PanelSlot's CSS width transition shrinks it,
    // and the browser clamps scrollLeft to the new scrollWidth automatically.
    prevPanelCountRef.current = panelCount
  }, [panelCount, isActive])

  // Collapse exiting panel with CSS transition when going back
  useEffect(() => {
    if (renderedChildren === children) return
    const el = scrollRef.current
    if (!el) {
      clearExit()
      return
    }

    const exitingPanel = el.lastElementChild as HTMLElement
    if (!exitingPanel) {
      clearExit()
      return
    }

    const w = exitingPanel.offsetWidth
    exitingPanel.style.width = `${w}px`
    exitingPanel.style.overflow = "hidden"
    exitingPanel.style.transition = `width ${DURATION}s ${EASE_CSS}, opacity ${DURATION * 0.6}s`

    // Clean up when the width transition finishes (longest of the two)
    const onEnd = (e: TransitionEvent) => {
      if (e.propertyName === "width") {
        exitingPanel.removeEventListener("transitionend", onEnd)
        clearExit()
      }
    }
    exitingPanel.addEventListener("transitionend", onEnd)

    requestAnimationFrame(() => {
      exitingPanel.style.width = "0px"
      exitingPanel.style.opacity = "0"
    })

    return () => exitingPanel.removeEventListener("transitionend", onEnd)
  }, [renderedChildren, children, clearExit])

  // Intercept horizontal wheel → redirect to outer scroll
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault()
        el.scrollLeft += e.deltaX
      }
    }
    el.addEventListener("wheel", handler, { passive: false })
    return () => el.removeEventListener("wheel", handler)
  }, [])

  return (
    <div
      ref={scrollRef}
      className="flex flex-row h-full gap-4 shrink-0 overflow-x-auto py-4 pr-4 pl-[var(--sidebar-width)]"
    >
      {renderedChildren}
    </div>
  )
}

export function Tab({ id, children }: TabProps) {
  const isMobile = useIsMobile()

  if (isMobile) {
    return <MobileTab id={id}>{children}</MobileTab>
  }

  return <DesktopTab id={id}>{children}</DesktopTab>
}
