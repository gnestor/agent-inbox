import { useRef, useState, useEffect } from "react"
import { Toaster } from "sonner"
import { SidebarInset, SidebarProvider } from "@hammies/frontend/components/ui"
import { useIsMobile } from "@hammies/frontend/hooks"
import { motion, AnimatePresence, usePresence } from "motion/react"
import { AppSidebar } from "@/components/layout/AppSidebar"
import { LoginPage } from "@/components/layout/LoginPage"
import { LiquidGlassFilter } from "@/components/layout/LiquidGlassFilter"
import { UserContext, useUserProvider, useUser } from "@/hooks/use-user"
import { NavigationProvider } from "@/components/navigation"
import { useNavigation } from "@/hooks/use-navigation"
import { getTabIndex } from "@/types/navigation"
import { EASE, DURATION } from "@/lib/navigation-constants"
import { EmailTab } from "@/components/email/EmailTab"
import { TaskTab } from "@/components/task/TaskTab"
import { CalendarTab } from "@/components/task/CalendarTab"
import { SessionTab } from "@/components/session/SessionTab"
import { IntegrationsPage } from "@/components/settings/IntegrationsPage"
import { Tab } from "@/components/navigation/Tab"
import { Panel } from "@/components/navigation/Panel"
import { PluginView } from "@/components/plugin/PluginView"

// --- Tab transition animation (same as old PanelStack AnimatedTabPane) ---

const GAP = 16

const tabVariants = {
  enter: (d: number) => ({
    y: d >= 0 ? `calc(100% + ${GAP}px)` : `calc(-100% - ${GAP}px)`,
    opacity: 1,
  }),
  center: { y: 0 as number | string, opacity: 1 },
}

function computeTabExit(d: number) {
  return {
    y: d >= 0 ? `calc(-100% - ${GAP}px)` : `calc(100% + ${GAP}px)`,
    opacity: 1 as const,
  }
}

function AnimatedTab({
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

  const [target, setTarget] = useState(tabVariants.center)

  useEffect(() => {
    if (!isPresent) {
      setTarget(computeTabExit(directionRef.current))
      const timer = setTimeout(() => safeRef.current?.(), DURATION * 1000 + 50)
      return () => clearTimeout(timer)
    }
  }, [isPresent, directionRef])

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

// --- Tab container: renders active tab with vertical transition ---

function TabContainer() {
  const { activeTab } = useNavigation()

  const prevTabRef = useRef(activeTab)
  const directionRef = useRef(0)

  if (activeTab !== prevTabRef.current) {
    const prevIdx = getTabIndex(prevTabRef.current)
    const nextIdx = getTabIndex(activeTab)
    directionRef.current = nextIdx > prevIdx ? 1 : -1
    prevTabRef.current = activeTab
  }

  const direction = directionRef.current

  function renderTab() {
    switch (activeTab) {
      case "emails": return <EmailTab />
      case "tasks": return <TaskTab />
      case "calendar": return <CalendarTab />
      case "sessions": return <SessionTab />
      case "settings":
        return (
          <Tab id="settings">
            <Panel id="settings" variant="settings">
              <IntegrationsPage />
            </Panel>
          </Tab>
        )
      default:
        if (activeTab.startsWith("plugin:")) return <PluginView />
        return <EmailTab />
    }
  }

  return (
    <div className="h-full w-full overflow-clip relative">
      <AnimatePresence initial={false}>
        <AnimatedTab
          key={activeTab}
          entryDirection={direction}
          directionRef={directionRef}
        >
          {renderTab()}
        </AnimatedTab>
      </AnimatePresence>
    </div>
  )
}

// --- App shell ---

function AuthenticatedApp() {
  return (
    <NavigationProvider>
      <SidebarProvider>
        <LiquidGlassFilter />
        <AppSidebar />
        <SidebarInset className="max-h-svh overflow-hidden">
          <div className="flex flex-1 h-full">
            <TabContainer />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </NavigationProvider>
  )
}

function AppContent() {
  const { user, loading } = useUser()

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    )
  }

  if (!user) return <LoginPage />

  return <AuthenticatedApp />
}

export function App() {
  const userContext = useUserProvider()

  return (
    <UserContext.Provider value={userContext}>
      <AppContent />
      <Toaster theme="dark" position="bottom-right" richColors />
    </UserContext.Provider>
  )
}
