import { useMemo, useContext, memo, type ComponentType } from "react"
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
import { pluginIdFromTab, setPluginOrder } from "@/types/navigation"
import { SlotStack } from "@/components/navigation/SlotStack"
import { EmailTab } from "@plugins/gmail/app/components/EmailTab"
import { SessionTab } from "@/components/session/SessionTab"
import { IntegrationsPage } from "@/components/settings/IntegrationsPage"
import { WorkspaceSettings } from "@/components/workspace/WorkspaceSettings"
import { Tab } from "@/components/navigation/Tab"
import { Panel } from "@/components/navigation/Panel"
import { PluginView } from "@/components/plugin/PluginView"
// import { PluginFrame } from "@/components/plugin/PluginFrame"  // TODO: re-enable for iframe-in-panel-slot rendering
import { usePlugins } from "@/hooks/use-plugins"

// Built-in plugin tab components — rendered directly (not via iframe)
// Plugins not in this registry use generic PluginView
const BUILTIN_TAB_REGISTRY: Record<string, ComponentType<{ tabId?: TabId }>> = {
  "gmail": EmailTab,
}

// Static slots that always exist in the navigation stack.
// Plugin tabs are added dynamically as users navigate to them.
const STATIC_SLOTS = [
  "settings",
  "workspace-settings",
  "sessions",
]

/**
 * Renders a plugin tab via PluginFrame (if the plugin declares components.tab)
 * or falls back to PluginView (generic fieldSchema-based rendering).
 */
const PluginTabSlot = memo(function PluginTabSlot({ tabId }: { tabId: TabId }) {
  const pluginId = pluginIdFromTab(tabId)

  // Check built-in tab registry first (direct React components, no iframe)
  if (pluginId && BUILTIN_TAB_REGISTRY[pluginId]) {
    const BuiltinTab = BUILTIN_TAB_REGISTRY[pluginId]
    return <BuiltinTab tabId={tabId} />
  }

  // No built-in tab — render generic list+detail UI from fieldSchema
  return <PluginView />
})

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
    return <PluginTabSlot tabId={tabId as TabId} />
  }
  return null
}

function RecentTabSlot({ tabId }: { tabId: TabId }) {
  const { getSourceTab } = useNavigation()
  const sourceTab = getSourceTab(tabId)
  // sourceTab is now plugin:gmail, plugin:notion-tasks, etc.
  if (sourceTab?.startsWith("plugin:")) {
    return <PluginTabSlot tabId={tabId} />
  }
  return <SessionTab tabId={tabId} />
}

function TabContainer() {
  const { activeTab } = useNavigation()
  const { data: plugins } = usePlugins()
  const ctx = useContext(NavigationContext)
  const tabs = ctx?.state.tabs

  // Stable plugin keys derived from the plugin manifest (not from tabs state)
  const pluginIds = useMemo(() => {
    const ids = (plugins ?? []).map((p) => p.id)
    setPluginOrder(ids) // Keep animation direction in sync
    return ids.map((id) => `plugin:${id}` as TabId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(plugins ?? []).map((p) => p.id).join(",")])

  // Recent keys from tabs state (these change less frequently)
  const recentKeys = useMemo(() => {
    if (!tabs) return [] as string[]
    return Object.keys(tabs)
      .filter((k) => k.startsWith("recent:"))
      .sort((a, b) => (tabs[a]?.sidebarIndex ?? 0) - (tabs[b]?.sidebarIndex ?? 0))
  }, [tabs])

  const keys = useMemo(() => {
    const sessionsIdx = STATIC_SLOTS.indexOf("sessions")
    const allPluginKeys = [...pluginIds]
    // Ensure the active tab is always in keys, even before plugins load
    if (activeTab.startsWith("plugin:") && !allPluginKeys.includes(activeTab)) {
      allPluginKeys.unshift(activeTab)
    }
    return [
      ...STATIC_SLOTS.slice(0, sessionsIdx),
      ...allPluginKeys,
      ...recentKeys,
      ...STATIC_SLOTS.slice(sessionsIdx),
    ]
  }, [pluginIds, recentKeys, activeTab])

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
