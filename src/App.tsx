import { useMemo, useContext, memo } from "react"
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
import { SessionTab } from "@/components/session/SessionTab"
import { IntegrationsPage } from "@/components/settings/IntegrationsPage"
import { WorkspaceSettings } from "@/components/workspace/WorkspaceSettings"
import { Tab } from "@/components/navigation/Tab"
import { Panel } from "@/components/navigation/Panel"
import { PluginView } from "@/components/plugin/PluginView"
import { PluginFrame } from "@/components/plugin/PluginFrame"
import { usePlugins } from "@/hooks/use-plugins"

// Static slots that always exist in the navigation stack.
// Plugin tabs are added dynamically as users navigate to them.
const STATIC_SLOTS = [
  "settings",
  "workspace-settings",
  "sessions",
]

/**
 * Derive the component name from a plugin's components.tab path.
 * e.g. "./app/components/EmailTab.tsx" → "EmailTab"
 */
function componentNameFromTabPath(tabPath: string): string {
  const parts = tabPath.replace(/\.tsx?$/, "").split("/")
  return parts[parts.length - 1]
}

/**
 * Renders a plugin tab via PluginFrame (if the plugin declares components.tab)
 * or falls back to PluginView (generic fieldSchema-based rendering).
 */
const PluginTabSlot = memo(function PluginTabSlot({ tabId }: { tabId: TabId }) {
  const { data: plugins } = usePlugins()
  const pluginId = pluginIdFromTab(tabId)
  const plugin = plugins?.find((p) => p.id === pluginId)

  if (pluginId && plugin?.components?.tab) {
    const componentName = componentNameFromTabPath(plugin.components.tab)
    return (
      <PluginFrame
        pluginId={pluginId}
        componentName={componentName}
        componentProps={{ tabId }}
        className="w-full h-full border-0"
      />
    )
  }

  // No custom component — render generic list+detail UI from fieldSchema
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
    return [
      ...STATIC_SLOTS.slice(0, sessionsIdx),
      ...pluginIds,
      ...recentKeys,
      ...STATIC_SLOTS.slice(sessionsIdx),
    ]
  }, [pluginIds, recentKeys])

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
