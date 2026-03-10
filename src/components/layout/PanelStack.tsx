import { useRef, useCallback, useState, useEffect } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { motion, AnimatePresence, useDragControls } from "motion/react"
import { useIsMobile } from "@hammies/frontend/hooks"
import { cn } from "@hammies/frontend/lib/utils"
import {
  useSpatialNav,
  tabStateFromPathname,
  buildUrl,
  TAB_ORDER,
  type TabId,
} from "@/hooks/use-spatial-nav"
import { HeaderNavContext } from "@/hooks/use-header-nav"
import { EmailList } from "@/components/email/EmailList"
import { EmailThread } from "@/components/email/EmailThread"
import { TaskList } from "@/components/task/TaskList"
import { TaskDetail } from "@/components/task/TaskDetail"
import { SessionList } from "@/components/session/SessionList"
import { SessionView } from "@/components/session/SessionView"
import { NewSessionPanel } from "@/components/session/NewSessionPanel"

const EASE: [number, number, number, number] = [0.32, 0.72, 0, 1]
const DURATION = 0.5

const ITEM_GAP = 16 // px gap between panels during list item navigation

const itemVariants = {
  enter: (d: number) => ({ y: d >= 0 ? `calc(100% + ${ITEM_GAP}px)` : `calc(-100% - ${ITEM_GAP}px)` }),
  center: { y: 0 },
  exit: (d: number) => ({ y: d >= 0 ? `calc(-100% - ${ITEM_GAP}px)` : `calc(100% + ${ITEM_GAP}px)` }),
}

// Parse current URL into panel state for the active tab
function usePanelState(tab: TabId) {
  const location = useLocation()
  const { activeTab, persistedState } = useSpatialNav()

  // For the active tab, derive from URL (fresh); for inactive tabs, use persisted state
  const state =
    tab === activeTab ? tabStateFromPathname(location.pathname, tab) : persistedState[tab]

  return {
    selectedId: state.selectedId,
    sessionOpen: state.sessionOpen ?? false,
    sessionId: state.sessionId,
  }
}

// Mobile overlay that slides in from right and supports drag-to-dismiss/forward
const DISMISS_THRESHOLD = 0.3 // fraction of width to trigger action
const DISMISS_VELOCITY = 400 // px/s velocity to trigger action
const TAB_SWIPE_THRESHOLD = 0.35 // fraction of height (drag down → prev tab)
const TAB_SWIPE_VELOCITY = 400 // px/s

// Large enough to cover any mobile screen — allows 1:1 drag tracking
const DRAG_RANGE = 1000

function MobileOverlayPanelInner({
  children,
  zIndex,
  onDismiss,
  onForward,
  onTabSwipe,
  hasPrevTab,
  hasNextTab,
  skipEntrance,
}: {
  children: React.ReactNode
  zIndex: number
  onDismiss?: () => void
  onForward?: () => void
  onTabSwipe?: (direction: 1 | -1) => void
  hasPrevTab?: boolean
  hasNextTab?: boolean
  skipEntrance?: boolean
}) {
  const [phase, setPhase] = useState<"open" | "dismissing">("open")
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss

  const controls = useDragControls()
  const isDraggable = !!(onDismiss || onForward)

  const handleDragEnd = (
    _e: PointerEvent,
    info: { velocity: { x: number; y: number }; offset: { x: number; y: number } },
  ) => {
    const { x: vx, y: vy } = info.velocity
    const { x: ox, y: oy } = info.offset
    const width = window.innerWidth
    const height = window.innerHeight

    // If the gesture is more vertical than horizontal, treat as tab swipe
    if (onTabSwipe && Math.abs(oy) > Math.abs(ox)) {
      // Drag DOWN 35% or fast → prev tab (above)
      if (vy > TAB_SWIPE_VELOCITY || oy > height * TAB_SWIPE_THRESHOLD) onTabSwipe(-1)
      // Drag UP 5% or fast → next tab (below) — limited space from title bar to screen edge
      else if (vy < -TAB_SWIPE_VELOCITY || oy < -height * 0.05) onTabSwipe(1)
      return
    }

    // Swipe right → dismiss (go back)
    if (onDismiss && (vx > DISMISS_VELOCITY || ox > width * DISMISS_THRESHOLD)) {
      setPhase("dismissing")
      return
    }

    // Swipe left → forward (go deeper)
    if (onForward && (vx < -DISMISS_VELOCITY || ox < -width * DISMISS_THRESHOLD)) {
      onForward()
      return
    }

    // Otherwise Motion snaps back to animate={{ x: 0 }} automatically
  }

  const springTransition = { type: "spring" as const, damping: 30, stiffness: 300 }

  const startOverlayDrag = useCallback((e: PointerEvent) => controls.start(e), [controls])

  return (
    <HeaderNavContext.Provider value={{ onTabSwipe, startOverlayDrag }}>
      <motion.div
        style={{ zIndex }}
        className="absolute inset-0 bg-card overflow-hidden"
        initial={skipEntrance ? { x: 0 } : { x: "100%" }}
        animate={{ x: phase === "open" ? 0 : "100%", y: 0 }}
        exit={{ x: "100%" }}
        transition={springTransition}
        onAnimationComplete={() => {
          if (phase === "dismissing") dismissRef.current?.()
        }}
        drag={isDraggable || !!onTabSwipe}
        dragDirectionLock
        dragListener={false}
        dragControls={controls}
        dragConstraints={{
          left: onForward ? -DRAG_RANGE : 0,
          right: onDismiss ? DRAG_RANGE : 0,
          top: onTabSwipe && hasNextTab ? -DRAG_RANGE : 0,
          bottom: onTabSwipe && hasPrevTab ? DRAG_RANGE : 0,
        }}
        dragElastic={0}
        dragMomentum={false}
        onDragEnd={handleDragEnd}
      >
        {children}
      </motion.div>
    </HeaderNavContext.Provider>
  )
}

function MobileOverlayPanel({
  children,
  zIndex,
  visible,
  onDismiss,
  onForward,
  onTabSwipe,
  hasPrevTab,
  hasNextTab,
  skipEntrance,
}: {
  children: React.ReactNode
  zIndex: number
  visible: boolean
  onDismiss?: () => void
  onForward?: () => void
  onTabSwipe?: (direction: 1 | -1) => void
  hasPrevTab?: boolean
  hasNextTab?: boolean
  skipEntrance?: boolean
}) {
  return (
    <AnimatePresence>
      {visible && (
        <MobileOverlayPanelInner
          key="panel"
          zIndex={zIndex}
          onDismiss={onDismiss}
          onForward={onForward}
          onTabSwipe={onTabSwipe}
          hasPrevTab={hasPrevTab}
          hasNextTab={hasNextTab}
          skipEntrance={skipEntrance}
        >
          {children}
        </MobileOverlayPanelInner>
      )}
    </AnimatePresence>
  )
}

function DetailContent({
  tab,
  selectedId,
  title,
}: {
  tab: TabId
  selectedId: string
  title: string
}) {
  if (tab === "emails") return <EmailThread threadId={selectedId} title={title} />
  if (tab === "tasks") return <TaskDetail taskId={selectedId} title={title} />
  return <SessionView sessionId={selectedId} title={title} />
}

function ItemSlider({
  tab,
  selectedId,
  sessionOpen,
  sessionId,
  directionRef,
  title,
}: {
  tab: TabId
  selectedId?: string
  sessionOpen: boolean
  sessionId?: string
  directionRef: React.RefObject<number>
  title: string
}) {
  if (!selectedId) return null

  // Read direction during ItemSlider's render (after EmailList has updated the ref)
  const direction = directionRef.current

  const renderContent = (id: string, sOpen: boolean, sId?: string) => (
    <div className="shrink-0 h-full flex flex-row">
      <div
        style={{ zIndex: 2 }}
        className="shrink-0 h-full w-[600px] bg-card rounded-lg shadow-sm ring-1 ring-inset ring-border overflow-hidden"
      >
        <DetailContent tab={tab} selectedId={id} title={title} />
      </div>
      <AnimatePresence>
        {tab !== "sessions" && sOpen && (
          <motion.div
            key="session"
            initial={{ width: 0 }}
            animate={{ width: 616 }}
            exit={{ width: 0 }}
            transition={{ duration: DURATION, ease: EASE }}
            style={{ zIndex: 1 }}
            className="shrink-0 h-full overflow-hidden pl-4"
          >
            <div className="w-[600px] h-full bg-card rounded-lg shadow-sm ring-1 ring-inset ring-border overflow-hidden">
              <NewSessionPanel
                threadId={tab === "emails" ? id : undefined}
                taskId={tab === "tasks" ? id : undefined}
                sessionId={sId}
                autoStart={!sId}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )

  return (
    <motion.div
      className="overflow-clip h-full p-px"
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 40 }}
      transition={{ duration: DURATION, ease: EASE }}
    >
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
    </motion.div>
  )
}

function TabPane({
  tab,
  isMobile,
  active,
  onTabSwipe,
  hasPrevTab,
  hasNextTab,
}: {
  tab: TabId
  isMobile: boolean
  active: boolean
  onTabSwipe?: (dir: 1 | -1) => void
  hasPrevTab?: boolean
  hasNextTab?: boolean
}) {
  const { selectedId, sessionOpen, sessionId } = usePanelState(tab)
  const directionRef = useRef(1)
  const prevIndexRef = useRef(-1)
  const [selectedTitle, setSelectedTitle] = useState("")
  const hasBeenActive = useRef(active)
  if (active) hasBeenActive.current = true
  const enabled = hasBeenActive.current
  // Skip entrance animation if detail was already open when this tab mounted (tab switch)
  const initialDetailId = useRef(selectedId)
  const skipEntrance = selectedId != null && selectedId === initialDetailId.current

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
        isMobile ? "w-full" : "w-[600px] rounded-lg shadow-sm ring-1 ring-inset ring-border",
      )}
    >
      {tab === "emails" && (
        <EmailList
          selectedThreadId={selectedId}
          onSelectedIndexChange={handleIndexChange}
          onSelectedTitleChange={setSelectedTitle}
          enabled={enabled}
        />
      )}
      {tab === "tasks" && (
        <TaskList
          selectedTaskId={selectedId}
          onSelectedIndexChange={handleIndexChange}
          onSelectedTitleChange={setSelectedTitle}
          enabled={enabled}
        />
      )}
      {tab === "sessions" && (
        <SessionList
          selectedSessionId={selectedId}
          onSelectedIndexChange={handleIndexChange}
          onSelectedTitleChange={setSelectedTitle}
          enabled={enabled}
        />
      )}
    </div>
  )

  const scrollRef = useRef<HTMLDivElement>(null)
  const prevSelectedId = useRef(selectedId)
  const prevSessionOpen = useRef(sessionOpen)

  useEffect(() => {
    if (isMobile) return
    const el = scrollRef.current
    if (!el) return

    const panelAdded =
      (!prevSelectedId.current && !!selectedId) ||
      (!prevSessionOpen.current && sessionOpen)
    const panelRemoved =
      (!!prevSelectedId.current && !selectedId) ||
      (prevSessionOpen.current && !sessionOpen)

    prevSelectedId.current = selectedId
    prevSessionOpen.current = sessionOpen

    if (panelAdded) {
      el.scrollTo({ left: el.scrollWidth, behavior: "smooth" })
    } else if (panelRemoved) {
      // Scroll back to show the panel that remains after dismissal
      const targetLeft = !selectedId ? 0 : el.scrollLeft - 616 // 600px panel + 16px gap
      el.scrollTo({ left: Math.max(0, targetLeft), behavior: "smooth" })
    }
  }, [selectedId, sessionOpen, isMobile])

  const navigate = useNavigate()

  const dismissDetail = useCallback(() => {
    navigate(buildUrl(tab, {}))
  }, [navigate, tab])

  const dismissSession = useCallback(() => {
    if (selectedId) navigate(buildUrl(tab, { selectedId }))
  }, [navigate, tab, selectedId])

  const openSession = useCallback(() => {
    if (selectedId && tab !== "sessions") {
      navigate(buildUrl(tab, { selectedId, sessionOpen: true }))
    }
  }, [navigate, tab, selectedId])

  if (isMobile) {
    return (
      <div className="h-full shrink-0 overflow-clip p-0 relative">
        {listPanel}
        <MobileOverlayPanel
          zIndex={10}
          visible={!!selectedId}
          onDismiss={dismissDetail}
          onForward={tab !== "sessions" && !sessionOpen ? openSession : undefined}
          onTabSwipe={onTabSwipe}
          hasPrevTab={hasPrevTab}
          hasNextTab={hasNextTab}
          skipEntrance={skipEntrance}
        >
          {selectedId && <DetailContent tab={tab} selectedId={selectedId} title={selectedTitle} />}
        </MobileOverlayPanel>
        <MobileOverlayPanel
          zIndex={20}
          visible={!!selectedId && sessionOpen}
          onDismiss={dismissSession}
          onTabSwipe={onTabSwipe}
          hasPrevTab={hasPrevTab}
          hasNextTab={hasNextTab}
          skipEntrance={skipEntrance}
        >
          {tab !== "sessions" && selectedId && (
            <NewSessionPanel
              threadId={tab === "emails" ? selectedId : undefined}
              taskId={tab === "tasks" ? selectedId : undefined}
              sessionId={sessionId}
              autoStart={!sessionId}
            />
          )}
        </MobileOverlayPanel>
      </div>
    )
  }

  return (
    <div ref={scrollRef} className="flex flex-row h-full gap-4 shrink-0 overflow-y-hidden overflow-x-auto py-4 pr-4 pl-0.5">
      {listPanel}
      <AnimatePresence>
        {selectedId && (
          <ItemSlider
            key="item-slider"
            tab={tab}
            selectedId={selectedId}
            sessionOpen={sessionOpen}
            sessionId={sessionId}
            directionRef={directionRef}
            title={selectedTitle}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

const GAP = 16 // px gap between tab panel groups during transition

const tabVariants = {
  enter: (d: number) => ({ y: d >= 0 ? `calc(100% + ${GAP}px)` : `calc(-100% - ${GAP}px)` }),
  center: { y: 0 },
  exit: (d: number) => ({ y: d >= 0 ? `calc(-100% - ${GAP}px)` : `calc(100% + ${GAP}px)` }),
}

export function PanelStack() {
  const { activeTab, navigateToTab } = useSpatialNav()
  const tabIndex = TAB_ORDER.indexOf(activeTab)
  const isMobile = useIsMobile()
  const prevTabIndexRef = useRef(tabIndex)
  const directionRef = useRef(0)
  const tabDragControls = useDragControls()

  if (tabIndex !== prevTabIndexRef.current) {
    directionRef.current = tabIndex > prevTabIndexRef.current ? 1 : -1
    prevTabIndexRef.current = tabIndex
  }

  const direction = directionRef.current
  const hasPrevTab = tabIndex > 0
  const hasNextTab = tabIndex < TAB_ORDER.length - 1

  const handleTabSwipe = useCallback(
    (dir: 1 | -1) => {
      const next = tabIndex + dir
      if (next >= 0 && next < TAB_ORDER.length) navigateToTab(TAB_ORDER[next])
    },
    [tabIndex, navigateToTab],
  )

  const startTabDrag = useCallback((e: PointerEvent) => tabDragControls.start(e), [tabDragControls])

  const handleTabPaneDragEnd = useCallback(
    (_: PointerEvent, info: { velocity: { y: number }; offset: { y: number } }) => {
      const { y: vy } = info.velocity
      const { y: oy } = info.offset
      const height = window.innerHeight
      if (vy > TAB_SWIPE_VELOCITY || oy > height * TAB_SWIPE_THRESHOLD) handleTabSwipe(-1)
      else if (vy < -TAB_SWIPE_VELOCITY || oy < -height * 0.05) handleTabSwipe(1)
    },
    [handleTabSwipe],
  )

  return (
    <HeaderNavContext.Provider
      value={{
        onTabSwipe: isMobile ? handleTabSwipe : undefined,
        startTabDrag: isMobile ? startTabDrag : undefined,
      }}
    >
      <div className="h-full w-full overflow-clip relative">
        <AnimatePresence initial={false} custom={direction}>
          <motion.div
            key={activeTab}
            custom={direction}
            variants={tabVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: DURATION, ease: EASE }}
            className="absolute inset-0"
            drag={isMobile ? "y" : false}
            dragControls={tabDragControls}
            dragListener={false}
            dragConstraints={{ top: hasNextTab ? -DRAG_RANGE : 0, bottom: hasPrevTab ? DRAG_RANGE : 0 }}
            dragElastic={0}
            dragMomentum={false}
            onDragEnd={isMobile ? handleTabPaneDragEnd : undefined}
          >
            <TabPane
              tab={activeTab}
              isMobile={isMobile}
              active={true}
              onTabSwipe={isMobile ? handleTabSwipe : undefined}
              hasPrevTab={hasPrevTab}
              hasNextTab={hasNextTab}
            />
          </motion.div>
        </AnimatePresence>
      </div>
    </HeaderNavContext.Provider>
  )
}
