import { useMemo, useEffect, useCallback, lazy, Suspense, type ReactNode } from "react"
import { Toaster } from "sonner"
import { SidebarInset, SidebarProvider } from "@hammies/frontend/components/ui"
import { AppSidebar } from "@/components/layout/AppSidebar"
import { LoginPage } from "@/components/layout/LoginPage"
import { LiquidGlassFilter } from "@hammies/frontend/components/LiquidGlassFilter"
import { UserContext, useUserProvider, useUser } from "@/hooks/use-user"
import { NavigationProvider } from "@/components/navigation"
import { useNavigationStore, useActiveTab, useNavActions, useSourceTab } from "@/lib/navigation-store"
import { useSortedPlugins } from "@/hooks/use-plugins"
import type { TabId } from "@/types/navigation"
import { setPluginOrder } from "@/types/navigation"
import { SlotStack } from "@/components/navigation/SlotStack"
import { SessionTab } from "@/components/session/SessionTab"
import { Tab } from "@/components/navigation/Tab"
import { Panel } from "@/components/navigation/Panel"
import { PluginView } from "@/components/plugin/PluginView"
import { ErrorBoundary } from "@/components/shared/ErrorBoundary"

const IntegrationsPage = lazy(() =>
  import("@/components/settings/IntegrationsPage").then((m) => ({ default: m.IntegrationsPage })),
)
const WorkspaceSettings = lazy(() =>
  import("@/components/workspace/WorkspaceSettings").then((m) => ({ default: m.WorkspaceSettings })),
)

const STATIC_SLOTS = [
  "sessions",
]

const SETTINGS_TABS = new Set(["settings", "workspace-settings"])

/** Wrap a tab's content in an error boundary keyed to the tab ID. */
function TabBoundary({ tabId, label, children }: { tabId: string; label: string; children: ReactNode }) {
  return (
    <ErrorBoundary resetKeys={[tabId]} label={label}>
      {children}
    </ErrorBoundary>
  )
}

function renderTab(tabId: string) {
  if (tabId === "settings") {
    return (
      <Tab id="settings">
        <Panel id="settings" variant="settings">
          <TabBoundary tabId={tabId} label="Settings">
            <Suspense><IntegrationsPage /></Suspense>
          </TabBoundary>
        </Panel>
      </Tab>
    )
  }
  if (tabId === "workspace-settings") {
    return (
      <Tab id="workspace-settings">
        <Panel id="workspace-settings" variant="settings">
          <TabBoundary tabId={tabId} label="Workspace Settings">
            <Suspense><WorkspaceSettings /></Suspense>
          </TabBoundary>
        </Panel>
      </Tab>
    )
  }
  if (tabId === "sessions") {
    return (
      <TabBoundary tabId={tabId} label="Sessions">
        <SessionTab />
      </TabBoundary>
    )
  }
  if (tabId.startsWith("recent:")) {
    return (
      <TabBoundary tabId={tabId} label="Recent Session">
        <RecentTabSlot tabId={tabId as TabId} />
      </TabBoundary>
    )
  }
  if (tabId.startsWith("plugin:")) {
    return (
      <TabBoundary tabId={tabId} label={tabId.replace("plugin:", "")}>
        <PluginView tabId={tabId as TabId} />
      </TabBoundary>
    )
  }
  return null
}

function RecentTabSlot({ tabId }: { tabId: TabId }) {
  const sourceTab = useSourceTab(tabId)
  if (sourceTab?.startsWith("plugin:")) {
    return <PluginView tabId={tabId} />
  }
  return <SessionTab tabId={tabId} />
}

function TabContainer() {
  const activeTab = useActiveTab()
  const tabs = useNavigationStore((s) => s.tabs)
  const sortedPlugins = useSortedPlugins()
  const { switchTab } = useNavActions()

  // Set plugin order for animation direction when plugins load
  useEffect(() => {
    if (sortedPlugins.length > 0) {
      setPluginOrder(sortedPlugins.map((p) => p.id))
    }
  }, [sortedPlugins])

  const keys = useMemo(() => {
    if (!tabs) return STATIC_SLOTS

    // Collect plugin tabs from loaded plugins (respecting user order)
    const pluginKeys = sortedPlugins.length > 0
      ? sortedPlugins.map((p) => `plugin:${p.id}`)
      : Object.keys(tabs).filter((k) => k.startsWith("plugin:"))

    const recentKeys = Object.keys(tabs)
      .filter((k) => k.startsWith("recent:"))
      .sort((a, b) => (tabs[a]?.sidebarIndex ?? 0) - (tabs[b]?.sidebarIndex ?? 0))

    // Settings tabs: mount at the top, unmount on navigate away
    const settingsKey = SETTINGS_TABS.has(activeTab) ? [activeTab] : []

    return [
      ...settingsKey,
      ...pluginKeys,
      ...recentKeys,
      ...STATIC_SLOTS,
    ]
  }, [tabs, sortedPlugins, activeTab])

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
    <ErrorBoundary label="App">
      <UserContext.Provider value={userContext}>
        <AppContent />
        <Toaster theme="dark" position="bottom-right" richColors />
      </UserContext.Provider>
    </ErrorBoundary>
  )
}
