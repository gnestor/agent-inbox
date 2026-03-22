// src/components/navigation/Tab.tsx
import { useRef, useEffect, useState, createContext, useContext, useCallback } from "react"
import { useIsMobile } from "@hammies/frontend/hooks"
import { useNavigation } from "@/hooks/use-navigation"
import type { TabId } from "@/types/navigation"
import { DURATION, EASE } from "@/lib/navigation-constants"

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

const ALL_TABS: TabId[] = ["settings", "emails", "tasks", "calendar", "sessions"]
const EASE_CSS = `cubic-bezier(${EASE.join(",")})`

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
  const { activeTab, getSelectedItemId, getPanels, getPanelTransition, switchTab } = useNavigation()
  const scrollRef = useRef<HTMLDivElement>(null)
  const isActive = activeTab === id
  const [snapEnabled, setSnapEnabled] = useState(false)
  const hasMounted = useRef(false)

  const panels = getPanels(id)
  void getSelectedItemId(id) // trigger re-render on selection change
  const targetPanelIndex = panels.length > 1 ? panels.length - 1 : 0

  const { renderedChildren, exitChildren, clearExit } = useExitChildren(children, targetPanelIndex, hasMounted, getPanelTransition(id))

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
      el.style.scrollSnapType = "none"
      if (smooth) {
        el.scrollTo({ left: target, behavior: "smooth" })
        const onDone = () => {
          el.style.scrollSnapType = "x mandatory"
          setSnapEnabled(true)
          if (exitChildren) clearExit()
        }
        el.addEventListener("scrollend", onDone, { once: true })
      } else {
        el.scrollLeft = target
        requestAnimationFrame(() => {
          el.style.scrollSnapType = "x mandatory"
          setSnapEnabled(true)
        })
      }
      hasMounted.current = true
    }

    // Wait for panel to be laid out if not yet in DOM
    if (el.scrollWidth <= el.clientWidth && target > 0) {
      const observer = new MutationObserver(() => {
        if (el.scrollWidth > el.clientWidth) {
          observer.disconnect()
          doScroll()
        }
      })
      observer.observe(el, { childList: true, subtree: true })
      const cleanup = setTimeout(() => observer.disconnect(), 1000)
      return () => { observer.disconnect(); clearTimeout(cleanup) }
    }

    doScroll()
  })

  // Vertical drag to switch tabs
  const onVerticalDrag = useCallback(
    (startY: number, firstMove: PointerEvent) => {
      const threshold = 60
      const currentIdx = ALL_TABS.indexOf(id)

      const trySwitch = (me: PointerEvent) => {
        const dy = me.clientY - startY
        if (Math.abs(dy) > threshold) {
          const nextIdx = dy < 0
            ? Math.min(currentIdx + 1, ALL_TABS.length - 1)
            : Math.max(currentIdx - 1, 0)
          if (nextIdx !== currentIdx) switchTab(ALL_TABS[nextIdx])
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
        style={{
          scrollSnapType: snapEnabled ? "x mandatory" : "none",
          scrollbarWidth: "none",
          WebkitOverflowScrolling: "touch",
        }}
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
  const isFirstRender = useRef(true)
  const savedScrollRef = useRef(0)
  const hasMounted = useRef(false)

  const panels = getPanels(id)
  const targetPanelIndex = panels.length > 1 ? panels.length - 1 : 0
  const { renderedChildren, clearExit } = useExitChildren(children, targetPanelIndex, hasMounted, getPanelTransition(id))

  // Save/restore scroll position when switching tabs
  useEffect(() => {
    if (isActive && scrollRef.current) {
      if (isFirstRender.current) {
        scrollRef.current.scrollLeft = savedScrollRef.current
        isFirstRender.current = false
      }
    }
    return () => {
      if (scrollRef.current) {
        savedScrollRef.current = scrollRef.current.scrollLeft
      }
    }
  }, [isActive])

  // Scroll to new panels when panel count increases
  useEffect(() => {
    if (!isActive || !scrollRef.current) return
    const el = scrollRef.current
    const currentCount = el.children.length

    if (currentCount > prevPanelCountRef.current && prevPanelCountRef.current > 0) {
      hasMounted.current = true
      requestAnimationFrame(() => {
        if (!scrollRef.current) return
        const target = scrollRef.current.scrollWidth - scrollRef.current.clientWidth
        if (isFirstRender.current) {
          scrollRef.current.scrollLeft = target
        } else {
          scrollRef.current.scrollTo({ left: target, behavior: "smooth" })
        }
      })
    }
    prevPanelCountRef.current = currentCount
    isFirstRender.current = false
    if (!hasMounted.current) hasMounted.current = true
  })

  // Collapse exiting panel with CSS transition when going back
  useEffect(() => {
    if (renderedChildren === children) return
    const el = scrollRef.current
    if (!el) { clearExit(); return }

    const exitingPanel = el.lastElementChild as HTMLElement
    if (!exitingPanel) { clearExit(); return }

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
      className="flex flex-row h-full gap-4 shrink-0 overflow-y-hidden overflow-x-auto py-4 pr-4 pl-[var(--sidebar-width)]"
      style={{ transition: `${DURATION}s all` }}
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
