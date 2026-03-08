import { useRef, useEffect, useCallback } from "react"
import { useLocation } from "react-router-dom"
import { motion, AnimatePresence } from "motion/react"
import { useIsMobile } from "@hammies/frontend/hooks"
import { cn } from "@hammies/frontend/lib/utils"
import { useSpatialNav, tabStateFromPathname, TAB_ORDER, type TabId } from "@/hooks/use-spatial-nav"
import { EmailList } from "@/components/email/EmailList"
import { EmailThread } from "@/components/email/EmailThread"
import { TaskList } from "@/components/task/TaskList"
import { TaskDetail } from "@/components/task/TaskDetail"
import { SessionList } from "@/components/session/SessionList"
import { SessionView } from "@/components/session/SessionView"
import { NewSessionPanel } from "@/components/session/NewSessionPanel"

const EASE = [0.32, 0.72, 0, 1] as const
const EASE_CSS = `cubic-bezier(${EASE.join(",")})`
const panelTransition = { duration: 1, ease: EASE }

// Parse current URL into panel state for the active tab
function usePanelState(tab: TabId) {
  const location = useLocation()
  const { activeTab, persistedState } = useSpatialNav()

  // For the active tab, derive from URL (fresh); for inactive tabs, use persisted state
  const state = tab === activeTab
    ? tabStateFromPathname(location.pathname, tab)
    : persistedState[tab]

  return {
    selectedId: state.selectedId,
    sessionOpen: state.sessionOpen ?? false,
    sessionId: state.sessionId,
  }
}

// Mobile overlay that snaps into place on mount (no enter animation since key changes remount it)
function MobileOverlayPanel({
  children,
  zIndex,
  visible,
}: {
  children: React.ReactNode
  zIndex: number
  visible: boolean
}) {
  if (!visible) return null

  return (
    <div
      style={{ zIndex }}
      className="absolute inset-0 bg-card overflow-hidden"
    >
      {children}
    </div>
  )
}


function DetailContent({ tab, selectedId }: { tab: TabId; selectedId: string }) {
  if (tab === "inbox") return <EmailThread threadId={selectedId} />
  if (tab === "tasks") return <TaskDetail taskId={selectedId} />
  return <SessionView sessionId={selectedId} />
}

// Vertical slide variants with direction support (same pattern as tab switch)
const itemSlideVariants = {
  enter: (d: number) => ({ y: `${d * 100}%` }),
  center: { y: 0 },
  exit: (d: number) => ({ y: `${-d * 100}%` }),
}

// Track click Y on list panel to determine vertical direction for item transitions
function useItemDirection(selectedId?: string) {
  const prevSelectedRef = useRef<string | undefined>(undefined)
  const directionRef = useRef(1)
  const lastClickYRef = useRef(0)
  const itemClickYRef = useRef(0)

  const trackClick = useCallback((e: React.MouseEvent) => {
    lastClickYRef.current = e.clientY
  }, [])

  if (selectedId && prevSelectedRef.current && selectedId !== prevSelectedRef.current) {
    directionRef.current = lastClickYRef.current >= itemClickYRef.current ? 1 : -1
    itemClickYRef.current = lastClickYRef.current
  }
  if (selectedId !== prevSelectedRef.current) {
    prevSelectedRef.current = selectedId
  }

  return { direction: directionRef.current, trackClick }
}

function TabPane({ tab, isMobile }: { tab: TabId; isMobile: boolean }) {
  const { selectedId, sessionOpen, sessionId } = usePanelState(tab)
  const { direction, trackClick } = useItemDirection(selectedId)

  const listPanel = (
    <div
      onClickCapture={isMobile ? undefined : trackClick}
      style={{ zIndex: isMobile ? undefined : 3 }}
      className={cn(
        "shrink-0 h-full bg-card overflow-hidden",
        isMobile ? "w-full" : "w-[600px] rounded-lg shadow-sm ring-1 ring-border",
      )}
    >
      {tab === "inbox" && <EmailList selectedThreadId={selectedId} />}
      {tab === "tasks" && <TaskList selectedTaskId={selectedId} />}
      {tab === "sessions" && <SessionList selectedSessionId={selectedId} />}
    </div>
  )

  if (isMobile) {
    return (
      <div className="h-full shrink-0 overflow-clip p-0 relative">
        {listPanel}
        <MobileOverlayPanel zIndex={10} visible={!!selectedId}>
          {selectedId && <DetailContent tab={tab} selectedId={selectedId} />}
        </MobileOverlayPanel>
        <MobileOverlayPanel zIndex={20} visible={!!selectedId && sessionOpen}>
          {tab !== "sessions" && selectedId && (
            <NewSessionPanel
              threadId={tab === "inbox" ? selectedId : undefined}
              taskId={tab === "tasks" ? selectedId : undefined}
              sessionId={sessionId}
            />
          )}
        </MobileOverlayPanel>
      </div>
    )
  }

  // Track whether this is an item switch (for conditional session animation)
  const isItemSwitch = useRef(false)
  const prevItemRef = useRef(selectedId)
  if (selectedId !== prevItemRef.current) {
    isItemSwitch.current = true
    prevItemRef.current = selectedId
  }
  useEffect(() => { isItemSwitch.current = false })

  return (
    <div className="flex flex-row h-full gap-4 shrink-0 overflow-y-hidden overflow-x-auto py-4 pr-4 pl-0.5">
      {listPanel}
      {/* Detail panel: vertical slide on item switch */}
      <div className="h-full shrink-0" style={{ clipPath: "inset(-4px)" }}>
        <AnimatePresence mode="popLayout" initial={false} custom={direction}>
          {selectedId && (
            <motion.div
              key={selectedId}
              custom={direction}
              variants={itemSlideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={panelTransition}
              style={{ zIndex: 2 }}
              className="h-full w-[600px] bg-card rounded-lg shadow-sm ring-1 ring-border overflow-hidden"
            >
              <DetailContent tab={tab} selectedId={selectedId} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {/* Session panel: horizontal slide on user open/close, vertical content slide on item switch */}
      <AnimatePresence mode="sync">
        {tab !== "sessions" && selectedId && sessionOpen && (
          <motion.div
            key="session"
            initial={isItemSwitch.current ? false : { x: "-100%" }}
            animate={{ x: 0 }}
            exit={isItemSwitch.current ? {} : { x: "-100%" }}
            transition={panelTransition}
            style={{ zIndex: 1 }}
            className="shrink-0 h-full w-[600px] bg-card rounded-lg shadow-sm ring-1 ring-border overflow-hidden"
          >
            <div className="h-full" style={{ clipPath: "inset(0)" }}>
              <AnimatePresence mode="popLayout" initial={false} custom={direction}>
                <motion.div
                  key={selectedId}
                  custom={direction}
                  variants={itemSlideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={panelTransition}
                  className="h-full"
                >
                  <NewSessionPanel
                    threadId={tab === "inbox" ? selectedId : undefined}
                    taskId={tab === "tasks" ? selectedId : undefined}
                    sessionId={sessionId}
                  />
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function PanelStack() {
  const { activeTab } = useSpatialNav()
  const tabIndex = TAB_ORDER.indexOf(activeTab)
  const isMobile = useIsMobile()
  const viewportRef = useRef<HTMLDivElement>(null)
  const sliderRef = useRef<HTMLDivElement>(null)
  const hasAnimated = useRef(false)
  const prevTabIndexRef = useRef(tabIndex)
  const tabIndexRef = useRef(tabIndex)

  // Animate/snap the vertical slider on tab switch
  useEffect(() => {
    const viewport = viewportRef.current
    const slider = sliderRef.current
    if (!viewport || !slider) return

    tabIndexRef.current = tabIndex

    const isTabSwitch = prevTabIndexRef.current !== tabIndex
    prevTabIndexRef.current = tabIndex
    const h = viewport.clientHeight

    if (isTabSwitch && hasAnimated.current) {
      slider.style.transition = `transform 1000ms ${EASE_CSS}`
      slider.getBoundingClientRect()
    } else {
      slider.style.transition = "none"
    }
    slider.style.transform = `translateY(${-tabIndex * h}px)`
    slider.style.height = `${h * TAB_ORDER.length}px`
    const panes = slider.children
    for (let i = 0; i < panes.length; i++) {
      (panes[i] as HTMLElement).style.height = `${h}px`
    }

    if (!hasAnimated.current && h > 0) {
      requestAnimationFrame(() => { hasAnimated.current = true })
    }
  }, [tabIndex])

  // Snap to correct position on resize (observer lives for component lifetime)
  useEffect(() => {
    const viewport = viewportRef.current
    const slider = sliderRef.current
    if (!viewport || !slider) return

    const ro = new ResizeObserver(() => {
      const h = viewport.clientHeight
      slider.style.transition = "none"
      slider.style.transform = `translateY(${-tabIndexRef.current * h}px)`
      slider.style.height = `${h * TAB_ORDER.length}px`
      const panes = slider.children
      for (let i = 0; i < panes.length; i++) {
        (panes[i] as HTMLElement).style.height = `${h}px`
      }
    })
    ro.observe(viewport)
    return () => ro.disconnect()
  }, [])

  return (
    <div ref={viewportRef} className="h-full w-full overflow-clip">
      <div ref={sliderRef} className="flex flex-col">
        {TAB_ORDER.map((tab) => (
          <div key={tab} className="shrink-0 overflow-clip">
            <TabPane tab={tab} isMobile={isMobile} />
          </div>
        ))}
      </div>
    </div>
  )
}
