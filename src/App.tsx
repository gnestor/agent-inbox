import { useMemo, useEffect, useContext, useCallback } from "react"
import { Toaster } from "sonner"
import { SidebarInset, SidebarProvider } from "@hammies/frontend/components/ui"
import { AppSidebar } from "@/components/layout/AppSidebar"
import { LoginPage } from "@/components/layout/LoginPage"
import { LiquidGlassFilter } from "@hammies/frontend/components/LiquidGlassFilter"
import { UserContext, useUserProvider, useUser } from "@/hooks/use-user"
import { NavigationProvider } from "@/components/navigation"
import { NavigationContext } from "@/components/navigation/NavigationProvider"
import { useNavigation } from "@/hooks/use-navigation"
import { usePlugins } from "@/hooks/use-plugins"
import { usePreference } from "@/hooks/use-preferences"
import type { TabId } from "@/types/navigation"
import { setPluginOrder } from "@/types/navigation"
import { SlotStack } from "@/components/navigation/SlotStack"
import { SessionTab } from "@/components/session/SessionTab"
import { IntegrationsPage } from "@/components/settings/IntegrationsPage"
import { WorkspaceSettings } from "@/components/workspace/WorkspaceSettings"
import { Tab } from "@/components/navigation/Tab"
import { Panel } from "@/components/navigation/Panel"
import { PluginView } from "@/components/plugin/PluginView"

const STATIC_SLOTS = [
  "settings",
  "workspace-settings",
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
    return <PluginView tabId={tabId as TabId} />
  }
  return null
}

function RecentTabSlot({ tabId }: { tabId: TabId }) {
  const { getSourceTab } = useNavigation()
  const sourceTab = getSourceTab(tabId)
  if (sourceTab?.startsWith("plugin:")) {
    return <PluginView tabId={tabId} />
  }
  return <SessionTab tabId={tabId} />
}

function TabContainer() {
  const { activeTab } = useNavigation()
  const ctx = useContext(NavigationContext)
  const tabs = ctx?.state.tabs
  const { data: plugins } = usePlugins()
  const [pluginOrderPref] = usePreference<string[]>("pluginOrder", [])

  // Sort plugins by user-defined order
  const sortedPlugins = useMemo(() => {
    if (!plugins) return []
    if (pluginOrderPref.length === 0) return plugins
    const orderMap = new Map(pluginOrderPref.map((id, i) => [id, i]))
    return [...plugins].sort((a, b) => {
      const ai = orderMap.get(a.id) ?? 999
      const bi = orderMap.get(b.id) ?? 999
      return ai - bi
    })
  }, [plugins, pluginOrderPref])

  // Set plugin order for animation direction when plugins load
  useEffect(() => {
    if (sortedPlugins.length > 0) {
      setPluginOrder(sortedPlugins.map((p) => p.id))
    }
  }, [sortedPlugins])

  const { switchTab } = useNavigation()

  const keys = useMemo(() => {
    if (!tabs) return STATIC_SLOTS

    // Collect plugin tabs from loaded plugins (respecting user order)
    const pluginKeys = sortedPlugins.length > 0
      ? sortedPlugins.map((p) => `plugin:${p.id}`)
      : Object.keys(tabs).filter((k) => k.startsWith("plugin:"))

    const recentKeys = Object.keys(tabs)
      .filter((k) => k.startsWith("recent:"))
      .sort((a, b) => (tabs[a]?.sidebarIndex ?? 0) - (tabs[b]?.sidebarIndex ?? 0))

    // Insert plugin tabs before sessions, recent tabs after plugins
    const sessionsIdx = STATIC_SLOTS.indexOf("sessions")
    return [
      ...STATIC_SLOTS.slice(0, sessionsIdx),
      ...pluginKeys,
      ...recentKeys,
      ...STATIC_SLOTS.slice(sessionsIdx),
    ]
  }, [tabs, plugins])

  // When user scroll-snaps to a different tab, sync the URL/sidebar
  const handleActiveKeyChange = useCallback((key: string) => {
    switchTab(key as TabId)
  }, [switchTab])

  return (
    <SlotStack
      activeKey={activeTab}
      keys={keys}
      renderItem={renderTab}
      onActiveKeyChange={handleActiveKeyChange}
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
        <SidebarInset className="max-h-svh">
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
