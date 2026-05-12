// src/components/navigation/NavigationProvider.tsx
//
// Sync-only component: no context, no reducer. Side effects only:
//   1. Hydrate store from IndexedDB + URL on mount
//   2. State → URL sync
//   3. URL → State sync (browser back/forward)
//   4. Debounced IndexedDB persistence

import { useEffect, useRef, type ReactNode } from "react"
import { useNavigate, useLocation } from "react-router-dom"
import type { TabState, TabId } from "@/types/navigation"
import { createDefaultNavigationState, createDefaultTabState, pluginIdFromTab } from "@/types/navigation"
import { saveNavigationState, loadNavigationState } from "@/lib/navigation-storage"
import { useNavigationStore, useActiveTab, createRecentTabState } from "@/lib/navigation-store"

// --- URL helpers (kept here since they're only used by this component) ---

export function buildUrl(activeTab: TabId, selectedItemId?: string, tabState?: TabState): string {
  if (activeTab === "settings") return "/settings/integrations"
  if (activeTab.startsWith("recent:") && tabState) {
    return buildRecentUrl(tabState)
  }
  if (activeTab.startsWith("plugin:")) {
    const pluginId = pluginIdFromTab(activeTab)
    return selectedItemId
      ? `/${pluginId}/${encodeURIComponent(selectedItemId)}`
      : `/${pluginId}`
  }
  return selectedItemId
    ? `/${activeTab}/${encodeURIComponent(selectedItemId)}`
    : `/${activeTab}`
}

function buildRecentUrl(tabState: TabState): string {
  const sourceTab = tabState.sourceTab ?? "sessions"
  const detailPanel = tabState.panels.find((p) => p.type === "detail")
  const sessionPanel = tabState.panels.find((p) => p.type === "session")
  const itemId = detailPanel?.props.itemId

  const sourcePath = pluginIdFromTab(sourceTab) ?? sourceTab

  if (sourceTab === "sessions") {
    const sid = sessionPanel?.props.sessionId ?? itemId
    return `/recent/sessions/${sid ? encodeURIComponent(sid) : ""}`
  }
  if (itemId && sessionPanel) {
    return `/recent/${sourcePath}/${encodeURIComponent(itemId)}/session/${encodeURIComponent(sessionPanel.props.sessionId)}`
  }
  if (itemId) {
    return `/recent/${sourcePath}/${encodeURIComponent(itemId)}`
  }
  return `/recent/${sourcePath}`
}

export interface ParsedUrl {
  tabId: TabId
  selectedId?: string
  sessionId?: string
  sourceTab?: TabId
}

export function parseUrl(pathname: string): ParsedUrl {
  const parts = pathname.split("/").filter(Boolean)
  if (parts[0] === "recent") {
    if (parts[1] === "sessions" && parts[2]) {
      const sessionId = decodeURIComponent(parts[2])
      return { tabId: `recent:${sessionId}`, sourceTab: "sessions", sessionId }
    }
    if (parts[1] && parts[2]) {
      const selectedId = decodeURIComponent(parts[2])
      const sessionId = parts[3] === "session" && parts[4] ? decodeURIComponent(parts[4]) : undefined
      const key = sessionId ?? selectedId
      const pluginId = parts[1]
      return { tabId: `recent:${key}`, sourceTab: `plugin:${pluginId}`, selectedId, sessionId }
    }
    return { tabId: "sessions" }
  }
  if (parts[0] === "settings") return { tabId: "settings" }
  if (parts[0] === "sessions")
    return { tabId: "sessions", selectedId: parts[1] ? decodeURIComponent(parts[1]) : undefined }
  if (parts[0] === "plugins" && parts[1])
    return { tabId: `plugin:${parts[1]}` as TabId, selectedId: parts[2] ? decodeURIComponent(parts[2]) : undefined }
  const pluginId = parts[0]
  if (pluginId) {
    return { tabId: `plugin:${pluginId}` as TabId, selectedId: parts[1] ? decodeURIComponent(parts[1]) : undefined }
  }
  return { tabId: "sessions" }
}

// --- Provider component (sync effects only) ---

export function NavigationProvider({ children }: { children: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const mountStarted = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const lastNavigatedUrl = useRef(location.pathname)

  // Set initial activeTab AND panels from URL synchronously so the first render
  // shows the correct panel layout (list + detail) without flashing. The async
  // hydration from IndexedDB will merge additional state (savedPanels, filters, etc.)
  // but the panels derived from the URL are enough to prevent the flash.
  const initializedFromUrl = useRef(false)
  if (!initializedFromUrl.current) {
    initializedFromUrl.current = true
    const parsed = parseUrl(location.pathname)
    const store = useNavigationStore.getState()

    if (parsed.tabId.startsWith("recent:") && !store.tabs[parsed.tabId]) {
      useNavigationStore.setState((s) => ({
        activeTab: parsed.tabId,
        tabs: { ...s.tabs, [parsed.tabId]: createRecentTabState(parsed) },
      }))
    } else {
      const updates: Partial<typeof store> = {}
      if (store.activeTab !== parsed.tabId) {
        updates.activeTab = parsed.tabId
      }
      // Build panels from URL so the first render shows the right layout
      const existingTab = store.tabs[parsed.tabId]
      if (parsed.selectedId) {
        const tab = existingTab ?? createDefaultTabState()
        tab.selectedItemId = parsed.selectedId
        tab.panels = [
          tab.panels[0] ?? { id: "list", type: "list", props: {} },
          { id: `detail:${parsed.selectedId}`, type: "detail", props: { itemId: parsed.selectedId } },
        ]
        if (parsed.sessionId) {
          tab.panels.push({
            id: `session:${parsed.sessionId}`,
            type: "session",
            props: { sessionId: parsed.sessionId, linkedItemId: parsed.selectedId },
          })
        }
        updates.tabs = { ...store.tabs, [parsed.tabId]: tab }
      } else if (!existingTab && parsed.tabId.startsWith("plugin:")) {
        updates.tabs = { ...store.tabs, [parsed.tabId]: createDefaultTabState() }
      }
      if (Object.keys(updates).length > 0) {
        useNavigationStore.setState(updates)
      }
    }
  }

  // 1. Hydrate from IndexedDB on mount, merge with URL
  useEffect(() => {
    if (mountStarted.current) return
    mountStarted.current = true

    ;(async () => {
      let base = await loadNavigationState()
      if (!base) base = createDefaultNavigationState()

      const parsed = parseUrl(location.pathname)
      base.activeTab = parsed.tabId

      if (parsed.tabId.startsWith("recent:")) {
        if (!base.tabs[parsed.tabId]) {
          base.tabs[parsed.tabId] = createRecentTabState(parsed)
        }
      } else {
        const tab = base.tabs[parsed.tabId] ?? createDefaultTabState()
        if (parsed.selectedId) {
          if (tab.selectedItemId !== parsed.selectedId) {
            tab.selectedItemId = parsed.selectedId
            const saved = tab.savedPanels?.[parsed.selectedId] ?? []
            tab.panels = [
              tab.panels[0] ?? { id: "list", type: "list", props: {} },
              { id: `detail:${parsed.selectedId}`, type: "detail", props: { itemId: parsed.selectedId } },
              ...saved,
            ]
          }
          if (parsed.sessionId) {
            if (!tab.panels.some((p) => p.type === "session" && p.props.sessionId === parsed.sessionId)) {
              tab.panels = tab.panels.filter((p) => p.type !== "session")
              tab.panels.push({
                id: `session:${parsed.sessionId}`,
                type: "session",
                props: { sessionId: parsed.sessionId, linkedItemId: parsed.selectedId },
              })
            }
          }
        } else {
          tab.selectedItemId = undefined
          tab.panels = [tab.panels[0] ?? { id: "list", type: "list", props: {} }]
        }
        base.tabs[parsed.tabId] = tab
      }

      for (const tab of Object.values(base.tabs)) {
        tab.panelTransition = "none"
      }

      lastNavigatedUrl.current = buildUrl(base.activeTab, base.tabs[base.activeTab]?.selectedItemId, base.tabs[base.activeTab])
      useNavigationStore.getState()._hydrate(base)
    })()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 2. Debounced IndexedDB persistence
  useEffect(() => {
    return useNavigationStore.subscribe((state) => {
      if (!state._initialized) return
      clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        // Extract only serializable data (exclude action functions)
        const { activeTab, tabs, _initialized } = state
        saveNavigationState({ activeTab, tabs, _initialized })
      }, 100)
    })
  }, [])

  // 3. State → URL sync
  const activeTab = useActiveTab()
  const activeTabState = useNavigationStore((s) => s.tabs[s.activeTab])
  const activeSelectedId = activeTabState?.selectedItemId
  const initialized = useNavigationStore((s) => s._initialized)

  useEffect(() => {
    if (!initialized) return
    const url = buildUrl(activeTab, activeSelectedId, activeTabState)
    if (url !== lastNavigatedUrl.current) {
      lastNavigatedUrl.current = url
      navigate(url)
    }
  }, [activeTab, activeSelectedId, activeTabState, navigate, initialized])

  // 4. URL → State sync (browser back/forward)
  useEffect(() => {
    if (!initialized) return
    if (location.pathname === lastNavigatedUrl.current) return
    lastNavigatedUrl.current = location.pathname

    const parsed = parseUrl(location.pathname)
    const store = useNavigationStore.getState()

    if (parsed.tabId.startsWith("recent:")) {
      if (store.tabs[parsed.tabId] && store.activeTab === parsed.tabId) return
      const newTabs = { ...store.tabs }
      if (!newTabs[parsed.tabId]) {
        newTabs[parsed.tabId] = createRecentTabState(parsed)
      }
      useNavigationStore.getState()._hydrate({ ...store, activeTab: parsed.tabId, tabs: newTabs })
      return
    }

    if (parsed.tabId !== store.activeTab) {
      useNavigationStore.getState().switchTab(parsed.tabId)
    }
    const currentSelectedId = store.tabs[store.activeTab]?.selectedItemId
    if (parsed.selectedId && parsed.selectedId !== currentSelectedId) {
      useNavigationStore.getState().selectItem(parsed.selectedId)
    } else if (!parsed.selectedId && currentSelectedId) {
      useNavigationStore.getState().deselectItem()
    }
    if (parsed.sessionId) {
      useNavigationStore.getState().openSession(parsed.sessionId)
    }
  }, [location.pathname, initialized])

  return <>{children}</>
}
