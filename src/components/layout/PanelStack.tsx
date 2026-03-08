import { useRef, useCallback } from "react"
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

const EASE: [number, number, number, number] = [0.32, 0.72, 0, 1]
const DURATION = 0.5

const itemVariants = {
  enter: (d: number) => ({ y: `${d * 100}%` }),
  center: { y: 0 },
  exit: (d: number) => ({ y: `${-d * 100}%` }),
}

// Parse current URL into panel state for the active tab
function usePanelState(tab: TabId) {
  const location = useLocation()
  const { activeTab, persistedState, getItemState } = useSpatialNav()

  // For the active tab, derive from URL (fresh); for inactive tabs, use persisted state
  const state = tab === activeTab
    ? tabStateFromPathname(location.pathname, tab)
    : persistedState[tab]

  // Merge persisted per-item session state (avoids waiting for navigate(replace:true) round-trip)
  if (tab !== "sessions" && state.selectedId && !state.sessionOpen) {
    const saved = getItemState(tab, state.selectedId)
    if (saved?.sessionOpen) {
      return {
        selectedId: state.selectedId,
        sessionOpen: true,
        sessionId: saved.sessionId,
      }
    }
  }

  return {
    selectedId: state.selectedId,
    sessionOpen: state.sessionOpen ?? false,
    sessionId: state.sessionId,
  }
}

// Mobile overlay that snaps into place on mount
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

function ItemSlider({
  tab,
  selectedId,
  sessionOpen,
  sessionId,
  directionRef,
}: {
  tab: TabId
  selectedId?: string
  sessionOpen: boolean
  sessionId?: string
  directionRef: React.RefObject<number>
}) {

  if (!selectedId) return null

  // Read direction during ItemSlider's render (after EmailList has updated the ref)
  const direction = directionRef.current

  const renderContent = (id: string, sOpen: boolean, sId?: string) => (
    <div className="shrink-0 h-full flex flex-row gap-4">
      <div
        style={{ zIndex: 2 }}
        className="shrink-0 h-full w-[600px] bg-card rounded-lg shadow-sm ring-1 ring-border overflow-hidden"
      >
        <DetailContent tab={tab} selectedId={id} />
      </div>
      {tab !== "sessions" && sOpen && (
        <div
          style={{ zIndex: 1 }}
          className="shrink-0 h-full w-[600px] bg-card rounded-lg shadow-sm ring-1 ring-border overflow-hidden"
        >
          <NewSessionPanel
            threadId={tab === "inbox" ? id : undefined}
            taskId={tab === "tasks" ? id : undefined}
            sessionId={sId}
          />
        </div>
      )}
    </div>
  )

  return (
    <div className="overflow-clip h-full">
      <AnimatePresence initial={false} mode="popLayout" custom={direction}>
        <motion.div
          key={selectedId}
          custom={direction}
          variants={itemVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: DURATION, ease: EASE }}
          className="h-full"
        >
          {renderContent(selectedId, sessionOpen, sessionId)}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

function TabPane({ tab, isMobile }: { tab: TabId; isMobile: boolean }) {
  const { selectedId, sessionOpen, sessionId } = usePanelState(tab)
  const directionRef = useRef(1)
  const prevIndexRef = useRef(-1)

  // Direction is computed synchronously during render (list renders before ItemSlider)
  const handleIndexChange = useCallback((index: number) => {
    if (prevIndexRef.current >= 0 && index !== prevIndexRef.current) {
      directionRef.current = index > prevIndexRef.current ? 1 : -1
    }
    prevIndexRef.current = index
  }, [])

  const listPanel = (
    <div
      style={{ zIndex: isMobile ? undefined : 3 }}
      className={cn(
        "shrink-0 h-full bg-card overflow-hidden",
        isMobile ? "w-full" : "w-[600px] rounded-lg shadow-sm ring-1 ring-border",
      )}
    >
      {tab === "inbox" && <EmailList selectedThreadId={selectedId} onSelectedIndexChange={handleIndexChange} />}
      {tab === "tasks" && <TaskList selectedTaskId={selectedId} onSelectedIndexChange={handleIndexChange} />}
      {tab === "sessions" && <SessionList selectedSessionId={selectedId} onSelectedIndexChange={handleIndexChange} />}
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

  return (
    <div className="flex flex-row h-full gap-4 shrink-0 overflow-y-hidden overflow-x-auto py-4 pr-4 pl-0.5">
      {listPanel}
      <ItemSlider
        tab={tab}
        selectedId={selectedId}
        sessionOpen={sessionOpen}
        sessionId={sessionId}
        directionRef={directionRef}
      />
    </div>
  )
}

export function PanelStack() {
  const { activeTab } = useSpatialNav()
  const tabIndex = TAB_ORDER.indexOf(activeTab)
  const isMobile = useIsMobile()
  const hasAnimated = useRef(false)

  const yTarget = `${-tabIndex * (100 / TAB_ORDER.length)}%`

  return (
    <div className="h-full w-full overflow-clip relative">
      <motion.div
        className="flex flex-col absolute inset-x-0 top-0"
        style={{ height: `${100 * TAB_ORDER.length}%` }}
        initial={false}
        animate={{ y: yTarget }}
        transition={hasAnimated.current
          ? { duration: DURATION, ease: EASE }
          : { duration: 0 }
        }
        onAnimationComplete={() => { hasAnimated.current = true }}
      >
        {TAB_ORDER.map((tab) => (
          <div key={tab} className="shrink-0 overflow-clip" style={{ height: `${100 / TAB_ORDER.length}%` }}>
            <TabPane tab={tab} isMobile={isMobile} />
          </div>
        ))}
      </motion.div>
    </div>
  )
}
