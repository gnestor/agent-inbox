// src/components/navigation/Tab.tsx
import { useRef, useEffect } from "react"
import { useIsMobile } from "@hammies/frontend/hooks"
import { useNavigation } from "@/hooks/use-navigation"
import type { TabId } from "@/types/navigation"

interface TabProps {
  id: TabId
  children: React.ReactNode
}

export function Tab({ id, children }: TabProps) {
  const { activeTab } = useNavigation()
  const isMobile = useIsMobile()
  const scrollRef = useRef<HTMLDivElement>(null)
  const isActive = activeTab === id
  const prevPanelCountRef = useRef(0)
  const isFirstRender = useRef(true)

  // Save scroll position when deactivating
  // Restore scroll position when activating
  const savedScrollRef = useRef(0)
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

  // Scroll new panels into view when panel count increases
  useEffect(() => {
    if (!isActive || !scrollRef.current) return
    const el = scrollRef.current
    const currentCount = el.children.length

    if (currentCount > prevPanelCountRef.current && prevPanelCountRef.current > 0) {
      const lastChild = el.lastElementChild
      if (lastChild) {
        if (isFirstRender.current) {
          lastChild.scrollIntoView({ inline: "end", block: "nearest" })
        } else {
          lastChild.scrollIntoView({ behavior: "smooth", inline: "end", block: "nearest" })
        }
      }
    } else if (currentCount < prevPanelCountRef.current) {
      const lastChild = el.lastElementChild
      if (lastChild) {
        lastChild.scrollIntoView({ behavior: "smooth", inline: "end", block: "nearest" })
      }
    }
    prevPanelCountRef.current = currentCount
    isFirstRender.current = false
  })

  // Intercept horizontal wheel events on inner panels → redirect to outer scroll (desktop only)
  useEffect(() => {
    if (isMobile) return // let browser handle touch scroll natively
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
  }, [isMobile])

  return (
    <div
      ref={scrollRef}
      className={
        isMobile
          // Mobile: full-screen panels, scroll-snap for touch swiping between panels
          ? "flex flex-row h-full shrink-0 overflow-y-hidden overflow-x-auto"
          // Desktop: panels with gap, sidebar offset, padding
          : "flex flex-row h-full gap-4 shrink-0 overflow-y-hidden overflow-x-auto py-4 pr-4 pl-[var(--sidebar-width)]"
      }
      style={isMobile ? {
        scrollSnapType: "x mandatory",
        scrollbarWidth: "none",
        WebkitOverflowScrolling: "touch",
      } : undefined}
    >
      {children}
    </div>
  )
}
