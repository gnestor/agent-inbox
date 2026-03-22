import { useMemo, useContext } from "react"
import { Toaster } from "sonner"
import { SidebarInset, SidebarProvider } from "@hammies/frontend/components/ui"
import { AppSidebar } from "@/components/layout/AppSidebar"
import { LoginPage } from "@/components/layout/LoginPage"
import { LiquidGlassFilter } from "@/components/layout/LiquidGlassFilter"
import { UserContext, useUserProvider, useUser } from "@/hooks/use-user"
import { NavigationProvider } from "@/components/navigation"
import { NavigationContext } from "@/components/navigation/NavigationProvider"
import { useNavigation } from "@/hooks/use-navigation"
import type { TabId } from "@/types/navigation"
import { SlotStack } from "@/components/navigation/SlotStack"
import { EmailTab } from "@/components/email/EmailTab"
import { TaskTab } from "@/components/task/TaskTab"
import { CalendarTab } from "@/components/task/CalendarTab"
import { SessionTab } from "@/components/session/SessionTab"
import { IntegrationsPage } from "@/components/settings/IntegrationsPage"
import { Tab } from "@/components/navigation/Tab"
import { Panel } from "@/components/navigation/Panel"
import { PluginView } from "@/components/plugin/PluginView"

const STATIC_SLOTS = ["settings", "emails", "tasks", "calendar", "sessions"]

function renderTab(tabId: string) {
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
      if (tabId.startsWith("recent:")) return <RecentTabSlot tabId={tabId as TabId} />
      if (tabId.startsWith("plugin:")) return <PluginView />
      return null
  }
}

function RecentTabSlot({ tabId }: { tabId: TabId }) {
  const { getSourceTab } = useNavigation()
  const sourceTab = getSourceTab(tabId)
  switch (sourceTab) {
    case "emails": return <EmailTab tabId={tabId} />
    case "tasks": return <TaskTab tabId={tabId} />
    default: return <SessionTab tabId={tabId} />
  }
}

function TabContainer() {
  const { activeTab } = useNavigation()
  const ctx = useContext(NavigationContext)
  const tabs = ctx?.state.tabs

  // Keys match sidebar layout: settings, emails, tasks, calendar, [recent sessions], sessions
  const keys = useMemo(() => {
    if (!tabs) return STATIC_SLOTS
    const recentKeys = Object.keys(tabs)
      .filter((k) => k.startsWith("recent:"))
      .sort((a, b) => (tabs[a]?.sidebarIndex ?? 0) - (tabs[b]?.sidebarIndex ?? 0))
    if (recentKeys.length === 0) return STATIC_SLOTS
    // Insert recent tabs between "calendar" and "sessions"
    return ["settings", "emails", "tasks", "calendar", ...recentKeys, "sessions"]
  }, [tabs])

  return (
    <SlotStack
      activeKey={activeTab}
      keys={keys}
      renderItem={renderTab}
      className="h-full w-full"
    />
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
