import { useRef, useCallback, useState, useEffect, useMemo } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { motion, AnimatePresence, useDragControls, useMotionValue, animate, usePresence } from "motion/react"
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
import { CalendarList } from "@/components/task/CalendarList"
import { CalendarDetail } from "@/components/task/CalendarDetail"
import { SessionList } from "@/components/session/SessionList"
import { SessionView } from "@/components/session/SessionView"
import { NewSessionPanel } from "@/components/session/NewSessionPanel"
import { RecentPane } from "@/components/session/RecentPane"
import { IntegrationsPage } from "@/components/settings/IntegrationsPage"
import { useSessions } from "@/hooks/use-sessions"
import { isRecentSession, getSessionUrl } from "@/components/session/SidebarRecentSessions"

export const EASE: [number, number, number, number] = [0.32, 0.72, 0, 1]
export const DURATION = 0.6

const ITEM_GAP = 16 // px gap between panels during list item navigation

export const PANEL_CARD = "shrink-0 h-full w-[600px] bg-card rounded-lg shadow-sm ring-1 ring-inset ring-border overflow-hidden"

// Shared animated slot: both entering and exiting items occupy the same grid cell
// so the container width never collapses mid-transition.
export function AnimatedItemSlot({
  itemKey,
  direction,
  children,
}: {
  itemKey: string
  direction: number
  children: React.ReactNode
}) {
  return (
    <div className="h-full shrink-0 overflow-clip p-px [overflow-clip-margin:1rem]">
      <div
        style={{
          display: "grid",
          gridTemplateRows: "minmax(0, 1fr)",
          height: "100%",
          overflow: "clip",
          overflowClipMargin: "1rem",
        }}
      >
        <AnimatePresence initial={false} custom={direction}>
          <motion.div
            key={itemKey}
            custom={direction}
            variants={itemVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: DURATION, ease: EASE }}
            style={{ gridRow: 1, gridColumn: 1 }}
            className="h-full"
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

export function smoothScrollTo(el: HTMLElement, left: number, rafRef: { current: number }) {
  cancelAnimationFrame(rafRef.current)
  const start = el.scrollLeft
  const distance = left - start
  if (distance === 0) return
  const durationMs = DURATION * 1000
  const startTime = performance.now()
  function step(now: number) {
    const t = Math.min((now - startTime) / durationMs, 1)
    const eased = 1 - Math.pow(1 - t, 3)
    el.scrollLeft = start + distance * eased
    if (t < 1) rafRef.current = requestAnimationFrame(step)
  }
  rafRef.current = requestAnimationFrame(step)
}

// Pure function — extracted for unit testing
export function getScrollTarget(
  prevId: string | undefined,
  selectedId: string | undefined,
  prevSession: boolean,
  sessionOpen: boolean,
  scrollLeft: number,
  scrollWidth: number,
  clientWidth: number,
): { target: number; deferred?: true } | null {
  const detailAdded = !prevId && !!selectedId
  const detailRemoved = !!prevId && !selectedId
  const itemChanged = prevId !== selectedId
  // Only scroll for session open/close when the item itself hasn't changed.
  // When switching items, the new item's session state is pre-existing — not a user action.
  const sessionAdded = !prevSession && sessionOpen && !itemChanged
  const sessionRemoved = prevSession && !sessionOpen && !itemChanged
  if (detailAdded) return { target: scrollWidth - clientWidth }
  if (sessionAdded) return { target: scrollWidth - clientWidth, deferred: true }
  if (sessionRemoved) return { target: Math.max(0, scrollLeft - 632) }
  if (detailRemoved) return { target: 0 }
  return null
}

export const itemVariants = {
  enter: (d: number) => ({
    y: d >= 0 ? `calc(100% + ${ITEM_GAP}px)` : `calc(-100% - ${ITEM_GAP}px)`,
  }),
  center: { y: 0 },
  exit: (d: number) => ({
    y: d >= 0 ? `calc(-100% - ${ITEM_GAP}px)` : `calc(100% + ${ITEM_GAP}px)`,
  }),
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
const DISMISS_THRESHOLD = 0.1 // fraction of width to trigger action
const DISMISS_VELOCITY = 400 // px/s velocity to trigger action
const TAB_SWIPE_THRESHOLD = 0.1 // fraction of height (drag down → prev tab)
const TAB_SWIPE_VELOCITY = 400 // px/s

// Large enough to cover any mobile screen — allows 1:1 drag tracking
const DRAG_RANGE = 1000

// Pure functions — extracted for unit testing

export function classifyTabDrag(vy: number, oy: number, height: number): "prev" | "next" | null {
  if (vy > TAB_SWIPE_VELOCITY || oy > height * TAB_SWIPE_THRESHOLD) return "prev"
  if (vy < -TAB_SWIPE_VELOCITY || oy < -height * 0.05) return "next"
  return null
}

export function classifyOverlayDrag(
  vx: number,
  vy: number,
  ox: number,
  oy: number,
  width: number,
  height: number,
  hasTabSwipe: boolean,
): "tabPrev" | "tabNext" | "dismiss" | "forward" | null {
  if (hasTabSwipe && Math.abs(oy) > Math.abs(ox)) {
    if (vy > TAB_SWIPE_VELOCITY || oy > height * TAB_SWIPE_THRESHOLD) return "tabPrev"
    if (vy < -TAB_SWIPE_VELOCITY || oy < -height * 0.05) return "tabNext"
    return null
  }
  if (vx > DISMISS_VELOCITY || ox > width * DISMISS_THRESHOLD) return "dismiss"
  if (vx < -DISMISS_VELOCITY || ox < -width * DISMISS_THRESHOLD) return "forward"
  return null
}

const SNAP_SPRING = { type: "spring" as const, stiffness: 400, damping: 35 }
const SLIDE_SPRING = { type: "spring" as const, damping: 30, stiffness: 300 }

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
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss

  const controls = useDragControls()
  const isDraggable = !!(onDismiss || onForward)

  // Use motion values so we can imperatively animate snap-back and dismiss.
  // With dragMomentum={false} Framer Motion does NOT auto-return the drag offset
  // to the animate target — only imperative animate() calls do that.
  const x = useMotionValue(skipEntrance ? 0 : window.innerWidth)
  const y = useMotionValue(0)

  useEffect(() => {
    if (!skipEntrance) animate(x, 0, SLIDE_SPRING)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleDragEnd = (
    _e: PointerEvent,
    info: { velocity: { x: number; y: number }; offset: { x: number; y: number } },
  ) => {
    const { x: vx, y: vy } = info.velocity
    const { x: ox, y: oy } = info.offset
    const action = classifyOverlayDrag(
      vx,
      vy,
      ox,
      oy,
      window.innerWidth,
      window.innerHeight,
      !!onTabSwipe,
    )
    if (action === "tabPrev") {
      onTabSwipe?.(-1)
      return
    }
    if (action === "tabNext") {
      onTabSwipe?.(1)
      return
    }
    if (action === "dismiss" && onDismiss) {
      animate(x, window.innerWidth, SLIDE_SPRING).then(() => dismissRef.current?.())
      return
    }
    if (action === "forward" && onForward) {
      animate(x, 0, SNAP_SPRING)
      onForward()
      return
    }
    // Below threshold — spring back to origin
    animate(x, 0, SNAP_SPRING)
    animate(y, 0, SNAP_SPRING)
  }

  const startOverlayDrag = useCallback((e: PointerEvent) => controls.start(e), [controls])

  return (
    <HeaderNavContext.Provider value={{ onTabSwipe, startOverlayDrag }}>
      <motion.div
        style={{ zIndex, x, y }}
        className="absolute inset-0 bg-card overflow-hidden"
        exit={{ x: window.innerWidth }}
        transition={SLIDE_SPRING}
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

export function DetailContent({
  tab,
  selectedId,
  title,
  sessionOpen,
}: {
  tab: TabId
  selectedId: string
  title: string
  sessionOpen?: boolean
}) {
  if (tab === "emails")
    return <EmailThread threadId={selectedId} title={title} sessionOpen={sessionOpen} />
  if (tab === "tasks")
    return <TaskDetail taskId={selectedId} title={title} sessionOpen={sessionOpen} />
  if (tab === "calendar")
    return <CalendarDetail itemId={selectedId} title={title} sessionOpen={sessionOpen} />
  return <SessionView sessionId={selectedId} title={title} />
}

function SessionPanelSlide({ tab, id, sId }: { tab: TabId; id: string; sId?: string }) {
  return (
    <motion.div
      style={{ zIndex: 1 }}
      className="shrink-0 h-full overflow-hidden pl-4 w-[632px]"
      exit={{ width: 0 }}
      transition={{ duration: DURATION, ease: EASE }}
    >
      <div
        className={PANEL_CARD}
        // style={{ width: "calc((100vw - var(--sidebar-width) - (16px * 4)) / 2)", minWidth: 600 }
      >
        <NewSessionPanel
          threadId={tab === "emails" ? id : undefined}
          taskId={tab === "tasks" || tab === "calendar" ? id : undefined}
          sessionId={sId}
        />
      </div>
    </motion.div>
  )
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
        // style={{ zIndex: 2, width: "calc((100vw - var(--sidebar-width) - (16px * 4)) / 2)", minWidth: 600 }}
        className={PANEL_CARD}
      >
        <DetailContent tab={tab} selectedId={id} title={title} sessionOpen={sOpen} />
      </div>
      <AnimatePresence>
        {tab !== "sessions" && sOpen && (
          <SessionPanelSlide key="session" tab={tab} id={id} sId={sId} />
        )}
      </AnimatePresence>
    </div>
  )

  return (
    <motion.div
      className="shrink-0 overflow-clip h-full p-px [overflow-clip-margin:1rem]"
      exit={{ opacity: 0 }}
      transition={{ duration: DURATION, ease: EASE }}
    >
      <AnimatedItemSlot itemKey={selectedId} direction={direction}>
        {renderContent(selectedId, sessionOpen, sessionId)}
      </AnimatedItemSlot>
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

  const listPanelRef = useRef<HTMLDivElement>(null)

  // Direction is computed synchronously during render (list renders before ItemSlider)
  const handleIndexChange = useCallback((index: number) => {
    if (prevIndexRef.current >= 0 && index !== prevIndexRef.current) {
      directionRef.current = index > prevIndexRef.current ? 1 : -1
    }
    prevIndexRef.current = index
  }, [])

  const listPanel = (
    <div
      ref={listPanelRef}
      style={{
        zIndex: isMobile ? undefined : 3,
        // width: "calc((100vw - var(--sidebar-width) - (16px * 4)) / 2)",
        minWidth: isMobile ? undefined : 600,
      }}
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
      {tab === "calendar" && (
        <CalendarList
          selectedItemId={selectedId}
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
  const scrollRafRef = useRef(0)
  const prevSelectedId = useRef<string | undefined>(undefined)
  const prevSessionOpen = useRef(false)
  // True only on the first effect run after mount — scroll instantly so the position
  // is already set before the tab enter animation plays, avoiding competing animations.
  const isFirstScroll = useRef(true)
  const itemSliderWrapperRef = useRef<HTMLDivElement>(null)

  // Intercept horizontal wheel events inside a panel and redirect them to the
  // outer horizontal scroll container, so trackpad horizontal swipes scroll the panel
  // group rather than getting absorbed by inner overflow-y-auto elements.
  useEffect(() => {
    if (isMobile) return
    const handler = (e: WheelEvent) => {
      if (!scrollRef.current) return
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault()
        scrollRef.current.scrollLeft += e.deltaX
      }
    }
    const els = [listPanelRef.current, itemSliderWrapperRef.current].filter(
      Boolean,
    ) as HTMLElement[]
    els.forEach((el) => el.addEventListener("wheel", handler, { passive: false }))
    return () => els.forEach((el) => el.removeEventListener("wheel", handler))
  }, [isMobile])

  useEffect(() => {
    if (isMobile) return
    const el = scrollRef.current
    if (!el) return

    const prevId = prevSelectedId.current
    const prevSession = prevSessionOpen.current
    prevSelectedId.current = selectedId
    prevSessionOpen.current = sessionOpen

    // Always clear on the first run after mount, even when action is null.
    // If we only cleared it after finding an action, a tab that mounts with no
    // selected item would keep first=true, then instant-scroll when the user
    // selects the first item — which should be smooth.
    const first = isFirstScroll.current
    isFirstScroll.current = false

    const action = getScrollTarget(
      prevId,
      selectedId,
      prevSession,
      sessionOpen,
      el.scrollLeft,
      el.scrollWidth,
      el.clientWidth,
    )
    if (!action) return

    if (action.deferred) {
      // Defer one frame so the session panel is fully laid out before measuring scrollWidth
      cancelAnimationFrame(scrollRafRef.current)
      scrollRafRef.current = requestAnimationFrame(() => {
        const el2 = scrollRef.current
        if (!el2) return
        if (first) {
          el2.scrollLeft = el2.scrollWidth - el2.clientWidth
        } else {
          smoothScrollTo(el2, el2.scrollWidth - el2.clientWidth, scrollRafRef)
        }
      })
    } else if (first) {
      el.scrollLeft = action.target
    } else {
      smoothScrollTo(el, action.target, scrollRafRef)
    }
  }, [selectedId, sessionOpen, isMobile])

  const navigate = useNavigate()

  const dismissDetail = useCallback(() => {
    navigate(buildUrl(tab, {}))
  }, [navigate, tab])

  const dismissSession = useCallback(() => {
    if (selectedId) {
      navigate(buildUrl(tab, { selectedId }))
    }
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
          {selectedId && (
            <DetailContent
              tab={tab}
              selectedId={selectedId}
              title={selectedTitle}
              sessionOpen={sessionOpen}
            />
          )}
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
              taskId={tab === "tasks" || tab === "calendar" ? selectedId : undefined}
              sessionId={sessionId}
            />
          )}
        </MobileOverlayPanel>
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      className="flex flex-row h-full gap-4 shrink-0 overflow-y-hidden overflow-x-auto py-4 pr-4 pl-[var(--sidebar-width)]"
    >
      {listPanel}
      <div ref={itemSliderWrapperRef} className="contents">
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
    </div>
  )
}

const GAP = 16 // px gap between tab panel groups during transition

// Pure functions exported for testing
export const tabVariants = {
  enter: (d: number) => ({
    y: d >= 0 ? `calc(100% + ${GAP}px)` : `calc(-100% - ${GAP}px)`,
    opacity: 1,
  }),
  center: { y: 0, opacity: 1 },
  exit: { opacity: 0, y: 0 },
}

export function computeTabExit(d: number) {
  return {
    y: d >= 0 ? `calc(-100% - ${GAP}px)` : `calc(100% + ${GAP}px)`,
    opacity: 1 as const,
  }
}

// Drives tab enter/exit with correct directional slide.
// Uses usePresence so the EXIT reads directionRef at the moment of exit — not
// at mount time — fixing the case where the exit direction differs from entry.
// Uses state-based animate target instead of useAnimation controls, which get
// cancelled by framer-motion's internal reconciliation during AnimatePresence swaps.
function AnimatedTabPane({
  children,
  entryDirection,
  directionRef,
}: {
  children: React.ReactNode
  entryDirection: number
  directionRef: React.RefObject<number>
}) {
  const [isPresent, safeToRemove] = usePresence()
  const safeRef = useRef(safeToRemove)
  safeRef.current = safeToRemove

  const [target, setTarget] = useState<{ y: number | string; opacity: number }>(tabVariants.center)

  // Exit: read current direction at the moment of removal, then animate out
  useEffect(() => {
    if (!isPresent) {
      const exit = computeTabExit(directionRef.current)
      setTarget(exit)
      const timer = setTimeout(() => safeRef.current?.(), DURATION * 1000 + 50)
      return () => clearTimeout(timer)
    }
  }, [isPresent]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <motion.div
      initial={tabVariants.enter(entryDirection)}
      animate={target}
      transition={{ duration: DURATION, ease: EASE }}
      className="absolute inset-0"
    >
      {children}
    </motion.div>
  )
}

function SettingsPane() {
  return (
    <div className="flex h-full pl-[var(--sidebar-width)] py-4 pr-4">
      <div className={PANEL_CARD}>
        <IntegrationsPage />
      </div>
    </div>
  )
}

export function PanelStack() {
  const { activeTab, navigateToTab } = useSpatialNav()
  const location = useLocation()
  const navigate = useNavigate()
  const isMobile = useIsMobile()

  // /recent/* routes use "recent" as the animKey; individual item transitions are handled
  // inside RecentPane. All direction is index-based: tabs are 0-3, recent sessions are 4+.
  const isRecentRoute = location.pathname.startsWith("/recent/")
  const isSettingsRoute = location.pathname.startsWith("/settings/")
  const animKey = isSettingsRoute ? "settings" : isRecentRoute ? "recent" : activeTab

  // Recent sessions for mobile swipe navigation (skip fetch on desktop)
  const { sessions } = useSessions(undefined, isMobile)
  const recentSessions = useMemo(
    () => (isMobile ? sessions.filter(isRecentSession).slice(0, 10) : []),
    [sessions, isMobile],
  )
  const recentSessionsRef = useRef(recentSessions)
  recentSessionsRef.current = recentSessions

  // Compute a global index: tabs use TAB_ORDER position, recent sessions use state.index.
  // Tab routes can also carry state.index to override (e.g. "All Sessions" at the end).
  const stateIndex = (location.state as { index?: number } | null)?.index
  const currentIndex = isRecentRoute
    ? (stateIndex ?? TAB_ORDER.length)
    : (stateIndex ?? TAB_ORDER.indexOf(activeTab))

  const prevAnimKeyRef = useRef(animKey)
  const prevIndexRef = useRef(currentIndex)
  const directionRef = useRef(0)

  if (animKey !== prevAnimKeyRef.current) {
    directionRef.current = currentIndex > prevIndexRef.current ? 1 : -1
    prevAnimKeyRef.current = animKey
  }
  prevIndexRef.current = currentIndex

  const direction = directionRef.current
  const tabIndex = TAB_ORDER.indexOf(activeTab)

  // hasPrevTab/hasNextTab account for recent sessions beyond the regular tab order
  const hasPrevTab = isRecentRoute ? true : tabIndex > 0
  const hasNextTab = isRecentRoute
    ? currentIndex < TAB_ORDER.length + recentSessions.length - 1
    : tabIndex < TAB_ORDER.length - 1 || recentSessions.length > 0

  const isRecentRouteRef = useRef(isRecentRoute)
  isRecentRouteRef.current = isRecentRoute
  const currentIndexRef = useRef(currentIndex)
  currentIndexRef.current = currentIndex
  const hasPrevTabRef = useRef(hasPrevTab)
  hasPrevTabRef.current = hasPrevTab
  const hasNextTabRef = useRef(hasNextTab)
  hasNextTabRef.current = hasNextTab

  const handleTabSwipe = useCallback(
    (dir: 1 | -1) => {
      const idx = currentIndexRef.current
      const nextIdx = idx + dir
      const recent = recentSessionsRef.current

      if (nextIdx >= 0 && nextIdx < TAB_ORDER.length) {
        // Navigate to a regular tab
        navigateToTab(TAB_ORDER[nextIdx])
      } else if (nextIdx >= TAB_ORDER.length && nextIdx < TAB_ORDER.length + recent.length) {
        // Navigate to a recent session
        const sessionIdx = nextIdx - TAB_ORDER.length
        const session = recent[sessionIdx]
        navigate(getSessionUrl(session), { state: { index: nextIdx } })
      }
    },
    [navigateToTab, navigate],
  )

  // Manual drag tracking for tab swipe — avoids Framer Motion dragControls binding
  // issues when the tab pane remounts via AnimatePresence on each tab switch.
  const tabY = useMotionValue(0)

  const startTabDrag = useCallback(
    (e: PointerEvent) => {
      const startClientY = e.clientY
      const startTime = performance.now()

      function cleanup() {
        window.removeEventListener("pointermove", onMove)
        window.removeEventListener("pointerup", onEnd)
        window.removeEventListener("pointercancel", onEnd)
      }

      function onMove(ev: PointerEvent) {
        const dy = ev.clientY - startClientY
        if (dy > 0 && !hasPrevTabRef.current) return
        if (dy < 0 && !hasNextTabRef.current) return
        tabY.set(dy)
      }

      function onEnd(ev: PointerEvent) {
        cleanup()
        const dy = ev.clientY - startClientY
        const dt = Math.max((performance.now() - startTime) / 1000, 0.05)
        const vy = dy / dt
        const action = classifyTabDrag(vy, dy, window.innerHeight)
        if (action === "prev" || action === "next") {
          tabY.set(0)
          handleTabSwipe(action === "prev" ? -1 : 1)
        } else {
          animate(tabY, 0, SNAP_SPRING)
        }
      }

      window.addEventListener("pointermove", onMove)
      window.addEventListener("pointerup", onEnd)
      window.addEventListener("pointercancel", onEnd)
    },
    [tabY, handleTabSwipe],
  )

  return (
    <HeaderNavContext.Provider
      value={{
        onTabSwipe: isMobile ? handleTabSwipe : undefined,
        startTabDrag: isMobile ? startTabDrag : undefined,
      }}
    >
      <div className="h-full w-full overflow-clip relative">
        {/* Persistent wrapper carries the drag-y offset; inner motion.div handles tab transitions */}
        <motion.div style={{ y: tabY }} className="absolute inset-0">
          <AnimatePresence initial={false}>
            <AnimatedTabPane
              key={animKey}
              entryDirection={direction}
              directionRef={directionRef}
            >
              {isSettingsRoute ? (
                <SettingsPane />
              ) : isRecentRoute ? (
                <RecentPane />
              ) : (
                <TabPane
                  tab={activeTab}
                  isMobile={isMobile}
                  active={true}
                  onTabSwipe={isMobile ? handleTabSwipe : undefined}
                  hasPrevTab={hasPrevTab}
                  hasNextTab={hasNextTab}
                />
              )}
            </AnimatedTabPane>
          </AnimatePresence>
        </motion.div>
      </div>
    </HeaderNavContext.Provider>
  )
}
