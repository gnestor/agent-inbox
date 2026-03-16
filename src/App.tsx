import { useRef, useEffect, useState } from "react"
import { Toaster } from "sonner"
import { SidebarInset, SidebarProvider } from "@hammies/frontend/components/ui"
import { AppSidebar } from "@/components/layout/AppSidebar"
import { LoginPage } from "@/components/layout/LoginPage"
import { LiquidGlassFilter } from "@/components/layout/LiquidGlassFilter"
import { UserContext, useUserProvider, useUser } from "@/hooks/use-user"
import { NavigationProvider } from "@/components/navigation"
import { useNavigation } from "@/hooks/use-navigation"
import type { TabId } from "@/types/navigation"
import { DURATION } from "@/lib/navigation-constants"
import { EmailTab } from "@/components/email/EmailTab"
import { TaskTab } from "@/components/task/TaskTab"
import { CalendarTab } from "@/components/task/CalendarTab"
import { SessionTab } from "@/components/session/SessionTab"
import { IntegrationsPage } from "@/components/settings/IntegrationsPage"
import { Tab } from "@/components/navigation/Tab"
import { Panel } from "@/components/navigation/Panel"
import { PluginView } from "@/components/plugin/PluginView"

// Tab order (matches getTabIndex in navigation.ts)
const TAB_SLOTS: TabId[] = ["settings", "emails", "tasks", "calendar", "sessions"]
const GAP = 16

function renderTab(tabId: TabId) {
  switch (tabId) {
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
      if (tabId.startsWith("plugin:")) return <PluginView />
      return null
  }
}

/**
 * TabContainer: All tabs rendered in a vertical column.
 * The column is translated via CSS transform to bring the active tab into view.
 * All tabs stay mounted (preserving state). overflow-hidden on the parent
 * (SidebarInset) clips content outside the viewport.
 */
function TabContainer() {
  const { activeTab } = useNavigation()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)
  const [settled, setSettled] = useState(false)

  const activeIndex = TAB_SLOTS.indexOf(activeTab as TabId)
  const safeIndex = activeIndex >= 0 ? activeIndex : 1

  // Measure container height
  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    setHeight(el.clientHeight)
    const ro = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Enable CSS transition after first paint
  useEffect(() => {
    requestAnimationFrame(() => setSettled(true))
  }, [])

  const offset = height > 0 ? -(safeIndex * (height + GAP)) : 0

  return (
    <div ref={wrapperRef} className="h-full w-full overflow-hidden">
      <div
        style={{
          transform: `translateY(${offset}px)`,
          transition: settled && height > 0
            ? `transform ${DURATION}s cubic-bezier(0.32, 0.72, 0, 1)`
            : "none",
          display: "flex",
          flexDirection: "column",
          gap: GAP,
        }}
      >
        {TAB_SLOTS.map((tabId) => (
          <div key={tabId} style={{ height, flexShrink: 0 }}>
            {renderTab(tabId)}
          </div>
        ))}
      </div>
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
