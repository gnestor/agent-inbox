import { useRef, useEffect } from "react"
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

const EASE_CSS = "cubic-bezier(0.32, 0.72, 0, 1)"
const panelTransition = { duration: 0.5, ease: [0.32, 0.72, 0, 1] as const }

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

function HorizontalPanel({
  children,
  zIndex,
}: {
  children: React.ReactNode
  zIndex: number
}) {
  return (
    <motion.div
      initial={{ x: "-100%" }}
      animate={{ x: 0 }}
      exit={{ x: "-100%" }}
      transition={panelTransition}
      style={{ zIndex }}
      className="shrink-0 h-full w-[600px] bg-card rounded-lg shadow-sm ring-1 ring-border overflow-hidden"
    >
      {children}
    </motion.div>
  )
}

function TabPane({ tab, isMobile }: { tab: TabId; isMobile: boolean }) {
  const { selectedId, sessionOpen, sessionId } = usePanelState(tab)

  const listPanel = (
    <div
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
        {tab === "inbox" && (
          <MobileOverlayPanel key={`email-thread:${selectedId}`} zIndex={10} visible={!!selectedId}>
            {selectedId && <EmailThread threadId={selectedId} />}
          </MobileOverlayPanel>
        )}
        {tab === "tasks" && (
          <MobileOverlayPanel key={`task-detail:${selectedId}`} zIndex={10} visible={!!selectedId}>
            {selectedId && <TaskDetail taskId={selectedId} />}
          </MobileOverlayPanel>
        )}
        {tab === "sessions" && (
          <MobileOverlayPanel key={`session:${selectedId}`} zIndex={10} visible={!!selectedId}>
            {selectedId && <SessionView sessionId={selectedId} />}
          </MobileOverlayPanel>
        )}
        {tab !== "sessions" && (
          <MobileOverlayPanel zIndex={20} visible={!!selectedId && sessionOpen}>
            {selectedId && (
              <NewSessionPanel
                threadId={tab === "inbox" ? selectedId : undefined}
                taskId={tab === "tasks" ? selectedId : undefined}
                sessionId={sessionId}
              />
            )}
          </MobileOverlayPanel>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-row h-full gap-4 shrink-0 overflow-y-hidden overflow-x-auto py-4 pr-4 pl-0.5">
      {listPanel}
      <AnimatePresence mode="sync">
        {tab === "inbox" && selectedId && (
          <HorizontalPanel key={`email-thread:${selectedId}`} zIndex={2}>
            <EmailThread threadId={selectedId} />
          </HorizontalPanel>
        )}
        {tab === "tasks" && selectedId && (
          <HorizontalPanel key={`task-detail:${selectedId}`} zIndex={2}>
            <TaskDetail taskId={selectedId} />
          </HorizontalPanel>
        )}
        {tab === "sessions" && selectedId && (
          <HorizontalPanel key={`session:${selectedId}`} zIndex={2}>
            <SessionView sessionId={selectedId} />
          </HorizontalPanel>
        )}
      </AnimatePresence>
      <AnimatePresence mode="sync">
        {tab !== "sessions" && selectedId && sessionOpen && (
          <HorizontalPanel key={`new-session:${tab}:${selectedId}`} zIndex={1}>
            <NewSessionPanel
              threadId={tab === "inbox" ? selectedId : undefined}
              taskId={tab === "tasks" ? selectedId : undefined}
              sessionId={sessionId}
            />
          </HorizontalPanel>
        )}
      </AnimatePresence>
    </div>
  )
}

export function PanelStack() {
  const { tabIndex } = useSpatialNav()
  const isMobile = useIsMobile()
  const viewportRef = useRef<HTMLDivElement>(null)
  const sliderRef = useRef<HTMLDivElement>(null)
  const hasAnimated = useRef(false)
  const prevTabIndexRef = useRef(tabIndex)

  // Imperatively position the vertical slider — avoids Framer Motion stale-height bugs
  useEffect(() => {
    const viewport = viewportRef.current
    const slider = sliderRef.current
    if (!viewport || !slider) return

    const h = viewport.clientHeight
    const y = -tabIndex * h
    const isTabSwitch = prevTabIndexRef.current !== tabIndex
    prevTabIndexRef.current = tabIndex

    if (isTabSwitch && hasAnimated.current) {
      slider.style.transition = "transform 500ms cubic-bezier(0.32, 0.72, 0, 1)"
    } else {
      slider.style.transition = "none"
    }
    slider.style.transform = `translateY(${y}px)`

    if (!hasAnimated.current && h > 0) {
      requestAnimationFrame(() => { hasAnimated.current = true })
    }
  }, [tabIndex])

  // On resize, snap to correct position instantly using fresh measurement
  useEffect(() => {
    const viewport = viewportRef.current
    const slider = sliderRef.current
    if (!viewport || !slider) return

    const reposition = () => {
      const h = viewport.clientHeight
      const y = -tabIndex * h
      slider.style.transition = "none"
      slider.style.transform = `translateY(${y}px)`
      // Also update pane heights
      const panes = slider.children
      slider.style.height = `${h * TAB_ORDER.length}px`
      for (let i = 0; i < panes.length; i++) {
        (panes[i] as HTMLElement).style.height = `${h}px`
      }
    }

    reposition()
    const ro = new ResizeObserver(reposition)
    ro.observe(viewport)
    return () => ro.disconnect()
  }, [tabIndex])

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
