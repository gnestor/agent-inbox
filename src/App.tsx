import { useMemo, useContext, type ComponentType } from "react"
import { Toaster } from "sonner"
import { SidebarInset, SidebarProvider } from "@hammies/frontend/components/ui"
import { AppSidebar } from "@/components/layout/AppSidebar"
import { LoginPage } from "@/components/layout/LoginPage"
import { LiquidGlassFilter } from "@hammies/frontend/components/LiquidGlassFilter"
import { UserContext, useUserProvider, useUser } from "@/hooks/use-user"
import { NavigationProvider } from "@/components/navigation"
import { NavigationContext } from "@/components/navigation/NavigationProvider"
import { useNavigation } from "@/hooks/use-navigation"
import type { TabId } from "@/types/navigation"
import { pluginIdFromTab } from "@/types/navigation"
import { SlotStack } from "@/components/navigation/SlotStack"
import { EmailTab } from "@/components/email/EmailTab"
import { TaskTab } from "@/components/task/TaskTab"
import { CalendarTab } from "@/components/task/CalendarTab"
import { SessionTab } from "@/components/session/SessionTab"
import { IntegrationsPage } from "@/components/settings/IntegrationsPage"
import { WorkspaceSettings } from "@/components/workspace/WorkspaceSettings"
import { Tab } from "@/components/navigation/Tab"
import { Panel } from "@/components/navigation/Panel"
import { PluginView } from "@/components/plugin/PluginView"

// Client-side component registry for built-in plugins.
// Maps plugin component keys (from Plugin.components) to React components.
const COMPONENT_REGISTRY: Record<string, ComponentType<{ tabId?: TabId }>> = {
  "gmail:tab": EmailTab,
  "notion-tasks:tab": TaskTab,
  "notion-calendar:tab": CalendarTab,
}

const STATIC_SLOTS = [
  "settings",
  "workspace-settings",
  "plugin:gmail",
  "plugin:notion-tasks",
  "plugin:notion-calendar",
  "sessions",
]

function renderTab(tabId: string) {
  if (tabId === "settings") {
    return (
      <Tab id="settings">
        <Panel id="settings" variant="settings">
          <IntegrationsPage />
        </Panel>
      </Tab>
    )
  }
  if (tabId === "workspace-settings") {
    return (
      <Tab id="workspace-settings">
        <Panel id="workspace-settings" variant="settings">
          <WorkspaceSettings />
        </Panel>
      </Tab>
    )
  }
  if (tabId === "sessions") return <SessionTab />
  if (tabId.startsWith("recent:")) return <RecentTabSlot tabId={tabId as TabId} />
  if (tabId.startsWith("plugin:")) {
    const pluginId = pluginIdFromTab(tabId)
    const componentKey = `${pluginId}:tab`
    const CustomTab = COMPONENT_REGISTRY[componentKey]
    if (CustomTab) return <CustomTab tabId={tabId as TabId} />
    return <PluginView />
  }
  return null
}

function RecentTabSlot({ tabId }: { tabId: TabId }) {
  const { getSourceTab } = useNavigation()
  const sourceTab = getSourceTab(tabId)
  // sourceTab is now plugin:gmail, plugin:notion-tasks, etc.
  if (sourceTab?.startsWith("plugin:")) {
    const pluginId = pluginIdFromTab(sourceTab)
    const componentKey = `${pluginId}:tab`
    const CustomTab = COMPONENT_REGISTRY[componentKey]
    if (CustomTab) return <CustomTab tabId={tabId} />
  }
  return <SessionTab tabId={tabId} />
}

function TabContainer() {
  const { activeTab } = useNavigation()
  const ctx = useContext(NavigationContext)
  const tabs = ctx?.state.tabs

  const keys = useMemo(() => {
    if (!tabs) return STATIC_SLOTS
    const recentKeys = Object.keys(tabs)
      .filter((k) => k.startsWith("recent:"))
      .sort((a, b) => (tabs[a]?.sidebarIndex ?? 0) - (tabs[b]?.sidebarIndex ?? 0))
    // Collect plugin tabs that aren't in STATIC_SLOTS (external plugins)
    const pluginKeys = Object.keys(tabs)
      .filter((k) => k.startsWith("plugin:") && !STATIC_SLOTS.includes(k))
    if (recentKeys.length === 0 && pluginKeys.length === 0) return STATIC_SLOTS
    // Insert recent tabs before sessions, add dynamic plugin tabs
    const sessionsIdx = STATIC_SLOTS.indexOf("sessions")
    return [
      ...STATIC_SLOTS.slice(0, sessionsIdx),
      ...pluginKeys,
      ...recentKeys,
      ...STATIC_SLOTS.slice(sessionsIdx),
    ]
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

function AppSkeleton() {
  return (
    <div className="flex h-svh">
      <div className="hidden md:block w-[300px] shrink-0 bg-sidebar" />
      <div className="flex-1" />
    </div>
  )
}

function AppContent() {
  const { user, loading } = useUser()

  if (loading) {
    return <AppSkeleton />
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
