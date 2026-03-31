// src/components/navigation/NavigationProvider.tsx
import { createContext, useEffect, useRef, useReducer, type ReactNode } from "react"
import { useNavigate, useLocation } from "react-router-dom"
import type { NavigationState, PanelState, TabId, TabState } from "@/types/navigation"
import { createDefaultNavigationState, createDefaultTabState, makeNewSessionPanel, pluginIdFromTab } from "@/types/navigation"

import { saveNavigationState, loadNavigationState } from "@/lib/navigation-storage"

// --- URL helpers ---

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

  // Extract the URL-safe source name from the tab ID (plugin:gmail → gmail, sessions → sessions)
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
  /** For recent:* tabs, the source tab that spawned this */
  sourceTab?: TabId
}

/** Parse a URL pathname into navigation intent. Pure function, no side effects. */
export function parseUrl(pathname: string): ParsedUrl {
  const parts = pathname.split("/").filter(Boolean)
  if (parts[0] === "recent") {
    // /recent/sessions/{sessionId}
    if (parts[1] === "sessions" && parts[2]) {
      const sessionId = decodeURIComponent(parts[2])
      return { tabId: `recent:${sessionId}`, sourceTab: "sessions", selectedId: sessionId }
    }
    // /recent/{source}/{id}/session/{sessionId}
    // Supports both legacy names (emails, tasks) and plugin IDs (gmail, notion-tasks)
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
  // Legacy /plugins/:id URLs
  if (parts[0] === "plugins" && parts[1])
    return { tabId: `plugin:${parts[1]}` as TabId, selectedId: parts[2] ? decodeURIComponent(parts[2]) : undefined }
  // All other paths: treat as plugin ID (or legacy name)
  // /gmail/{id}, /notion-tasks/{id}, /emails/{id} (backward compat), etc.
  const pluginId = parts[0]
  if (pluginId) {
    return { tabId: `plugin:${pluginId}` as TabId, selectedId: parts[1] ? decodeURIComponent(parts[1]) : undefined }
  }
  return { tabId: "sessions" }
}

/** Build an ephemeral tab state for a /recent/ route (no list panel). */
function createRecentTabState(parsed: ParsedUrl): TabState {
  const panels: PanelState[] = []
  if (parsed.selectedId && parsed.sourceTab !== "sessions") {
    panels.push({ id: `detail:${parsed.selectedId}`, type: "detail", props: { itemId: parsed.selectedId } })
  }
  if (parsed.sessionId) {
    panels.push({
      id: `session:${parsed.sessionId}`,
      type: "session",
      props: { sessionId: parsed.sessionId, linkedItemId: parsed.selectedId },
    })
  } else if (parsed.sourceTab === "sessions" && parsed.selectedId) {
    // /recent/sessions/{sessionId} — the selectedId IS the sessionId
    panels.push({
      id: `detail:${parsed.selectedId}`,
      type: "detail",
      props: { itemId: parsed.selectedId },
    })
  }
  return {
    panelScrollOffset: 0,
    panels,
    sourceTab: parsed.sourceTab,
    selectedItemId: parsed.selectedId,
  }
}

// --- Actions ---

export type NavAction =
  | { type: "SET_STATE"; state: NavigationState }
  | { type: "SWITCH_TAB"; tabId: TabId }
  | { type: "SELECT_ITEM"; itemId: string; listIndex?: number }
  | { type: "DESELECT_ITEM" }
  | { type: "PUSH_PANEL"; panel: PanelState }
  | { type: "POP_PANEL"; panelId: string }
  | { type: "REMOVE_PANEL"; panelId: string }
  | { type: "REPLACE_PANEL"; panelId: string; newPanel: PanelState; selectedItemId?: string }
  | { type: "OPEN_SESSION"; sessionId?: string }
  | { type: "OPEN_NEW_SESSION"; source?: { type: string; id: string; content?: string } }
  | { type: "OPEN_RECENT"; sessionId: string; sourceTab: TabId; selectedId?: string; sidebarIndex: number }
  | { type: "SET_FILTER"; key: string; value: string }
  | { type: "CLEAR_FILTERS" }

function getOrCreateTab(state: NavigationState, tabId: TabId): TabState {
  return state.tabs[tabId] ?? createDefaultTabState()
}

/** Save extra panels (position 2+) for the current item, or clear stale entries */
function saveExtraPanels(tab: TabState) {
  const id = tab.selectedItemId
  if (!id) return
  if (tab.panels.length > 2) {
    tab.savedPanels = { ...tab.savedPanels, [id]: tab.panels.slice(2) }
  } else if (tab.savedPanels?.[id]) {
    const { [id]: _, ...rest } = tab.savedPanels
    tab.savedPanels = Object.keys(rest).length > 0 ? rest : undefined
  }
}

function navReducer(state: NavigationState, action: NavAction): NavigationState {
  switch (action.type) {
    case "SET_STATE":
      return { ...action.state, _initialized: true }

    case "SWITCH_TAB": {
      const tabs = state.tabs[action.tabId]
        ? state.tabs
        : { ...state.tabs, [action.tabId]: createDefaultTabState() }
      return { ...state, activeTab: action.tabId, tabs }
    }

    case "SELECT_ITEM": {
      const tab = { ...getOrCreateTab(state, state.activeTab) }
      saveExtraPanels(tab)

      tab.selectedItemId = action.itemId
      tab.panelTransition = "item"

      // Compute direction from list index
      if (action.listIndex !== undefined) {
        const prev = tab.prevListIndex ?? 0
        tab.itemDirection = action.listIndex > prev ? 1 : action.listIndex < prev ? -1 : 1
        tab.prevListIndex = action.listIndex
      }

      // Build new panels: list + detail + any saved extra panels for this item
      const saved = tab.savedPanels?.[action.itemId] ?? []
      tab.panels = [
        tab.panels[0],
        { id: `detail:${action.itemId}`, type: "detail", props: { itemId: action.itemId } },
        ...saved,
      ]

      return { ...state, tabs: { ...state.tabs, [state.activeTab]: tab } }
    }

    case "DESELECT_ITEM": {
      const tab = { ...getOrCreateTab(state, state.activeTab) }
      saveExtraPanels(tab)
      tab.selectedItemId = undefined
      tab.panels = tab.panels.slice(0, 1) // keep only list
      tab.panelTransition = "none"
      return { ...state, tabs: { ...state.tabs, [state.activeTab]: tab } }
    }

    case "PUSH_PANEL": {
      const tab = { ...getOrCreateTab(state, state.activeTab) }
      // Don't push duplicates
      if (tab.panels.some((p) => p.id === action.panel.id)) return state
      tab.panels = [...tab.panels, action.panel]
      tab.panelTransition = "none"
      return { ...state, tabs: { ...state.tabs, [state.activeTab]: tab } }
    }

    case "POP_PANEL": {
      const tab = { ...getOrCreateTab(state, state.activeTab) }
      const idx = tab.panels.findIndex((p) => p.id === action.panelId)
      if (idx >= 0) {
        tab.panels = tab.panels.slice(0, idx)
        if (!tab.panels.some((p) => p.type === "detail")) {
          tab.selectedItemId = undefined
        }
      }
      tab.panelTransition = "none"
      return { ...state, tabs: { ...state.tabs, [state.activeTab]: tab } }
    }

    case "REMOVE_PANEL": {
      const tab = { ...getOrCreateTab(state, state.activeTab) }
      tab.panels = tab.panels.filter((p) => p.id !== action.panelId)
      if (!tab.panels.some((p) => p.type === "detail")) {
        tab.selectedItemId = undefined
      }
      tab.panelTransition = "none"
      return { ...state, tabs: { ...state.tabs, [state.activeTab]: tab } }
    }

    case "REPLACE_PANEL": {
      const tab = { ...getOrCreateTab(state, state.activeTab) }
      tab.panels = tab.panels.map((p) => (p.id === action.panelId ? action.newPanel : p))
      if (action.selectedItemId !== undefined) tab.selectedItemId = action.selectedItemId
      tab.panelTransition = "none"
      return { ...state, tabs: { ...state.tabs, [state.activeTab]: tab } }
    }

    case "OPEN_SESSION": {
      const tab = { ...getOrCreateTab(state, state.activeTab) }
      const sessionId = action.sessionId ?? "new"
      const sessionPanel: PanelState = {
        id: `session:${sessionId}`,
        type: "session",
        props: { sessionId, linkedItemId: tab.selectedItemId },
      }
      const existingIdx = tab.panels.findIndex((p) => p.type === "session")
      if (existingIdx >= 0) {
        tab.panels = [...tab.panels]
        tab.panels[existingIdx] = sessionPanel
      } else {
        tab.panels = [...tab.panels, sessionPanel]
      }
      tab.panelTransition = "none"
      return { ...state, tabs: { ...state.tabs, [state.activeTab]: tab } }
    }

    case "OPEN_NEW_SESSION": {
      const tab = { ...getOrCreateTab(state, state.activeTab) }
      if (tab.panels.some((p) => p.id === "new_session")) return state
      const newSessionPanel = makeNewSessionPanel(action.source)
      // If an item is selected, keep the detail panel and add compose after it
      if (tab.selectedItemId) {
        const detailPanels = tab.panels.filter((p) => p.type === "list" || p.type === "detail")
        tab.panels = [...detailPanels, newSessionPanel]
      } else {
        tab.selectedItemId = undefined
        tab.panels = [tab.panels[0], newSessionPanel]
      }
      return { ...state, tabs: { ...state.tabs, [state.activeTab]: tab } }
    }

    case "OPEN_RECENT": {
      const tabId: TabId = `recent:${action.sessionId}`
      // Reuse existing tab state (preserves artifact panels) or create fresh
      const tab = state.tabs[tabId] ? { ...state.tabs[tabId] } : createRecentTabState({
        tabId,
        sourceTab: action.sourceTab,
        selectedId: action.selectedId,
        sessionId: action.sessionId,
      })

      // Compute direction from previous recent tab's sidebar position
      const oldTab = state.activeTab.startsWith("recent:") ? state.tabs[state.activeTab] : undefined
      const oldIdx = oldTab?.sidebarIndex ?? -1
      tab.itemDirection = action.sidebarIndex > oldIdx ? 1 : action.sidebarIndex < oldIdx ? -1 : 1
      tab.sidebarIndex = action.sidebarIndex
      tab.panelTransition = "item"

      return { ...state, activeTab: tabId, tabs: { ...state.tabs, [tabId]: tab } }
    }

    case "SET_FILTER": {
      const tab = { ...getOrCreateTab(state, state.activeTab) }
      tab.activeFilters = { ...tab.activeFilters, [action.key]: action.value }
      return { ...state, tabs: { ...state.tabs, [state.activeTab]: tab } }
    }

    case "CLEAR_FILTERS": {
      const tab = { ...getOrCreateTab(state, state.activeTab) }
      tab.activeFilters = undefined
      return { ...state, tabs: { ...state.tabs, [state.activeTab]: tab } }
    }

    default:
      return state
  }
}

// --- Context ---

export interface NavigationContextValue {
  state: NavigationState
  dispatch: React.Dispatch<NavAction>
}

export const NavigationContext = createContext<NavigationContextValue | null>(null)

// --- Provider ---

export function NavigationProvider({ children }: { children: ReactNode }) {
  const location = useLocation()
  // Derive initial activeTab from URL synchronously so SlotStack renders
  // at the correct scroll position on the first frame (no flash of Emails tab).
  const [state, dispatch] = useReducer(navReducer, location.pathname, (pathname) => {
    const parsed = parseUrl(pathname)
    const base = createDefaultNavigationState()
    base.activeTab = parsed.tabId
    // Create ephemeral tab state for recent:* URLs so SlotStack has the key
    if (parsed.tabId.startsWith("recent:")) {
      base.tabs[parsed.tabId] = createRecentTabState(parsed)
    }
    // Create tab state for plugin tabs not in the default set (external plugins)
    if (parsed.tabId.startsWith("plugin:") && !base.tabs[parsed.tabId]) {
      base.tabs[parsed.tabId] = createDefaultTabState()
    }
    return base
  })
  const navigate = useNavigate()
  const mountStarted = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Keep a ref to the latest state so the URL→state effect (which intentionally
  // omits `state` from its deps) can read fresh values instead of stale closures.
  const stateRef = useRef(state)
  stateRef.current = state

  // Tracks the last URL we programmatically navigated to, so the URL→state
  // effect can distinguish our navigations from browser back/forward.
  const lastNavigatedUrl = useRef(location.pathname)

  // Load persisted state on mount, merging with URL (URL is source of truth).
  // mountStarted prevents double-mount; initialized gates other effects until
  // the async load completes (so the state→URL effect can't fire with default state).
  useEffect(() => {
    if (mountStarted.current) return
    mountStarted.current = true

    ;(async () => {
      // 1. URL is the source of truth on refresh
      // (parsed result used below in step 3)

      // 2. Persisted state supplements (panel stacks, filters, scroll, savedPanels)
      let base = await loadNavigationState()
      if (!base) base = createDefaultNavigationState()

      // 3. Override activeTab and selectedItemId from URL
      const parsed = parseUrl(location.pathname)
      base.activeTab = parsed.tabId

      if (parsed.tabId.startsWith("recent:")) {
        // Use persisted state if available, otherwise build from URL
        if (!base.tabs[parsed.tabId]) {
          base.tabs[parsed.tabId] = createRecentTabState(parsed)
        }
      } else {
        const tab = base.tabs[parsed.tabId] ?? createDefaultTabState()
        if (parsed.selectedId) {
          // If persisted state already matches the URL's selected item,
          // keep the persisted panels (preserves extra panels like code_editor).
          // Only rebuild if the selected item changed.
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
            // Ensure session panel exists (URL may include /session/ suffix)
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

      // 4. Clear panelTransition on all tabs so persisted "item" transitions
      //    don't trigger slide animations on load.
      for (const tab of Object.values(base.tabs)) {
        tab.panelTransition = "none"
      }

      // 5. Dispatch merged state; URL already correct, no navigate() needed
      lastNavigatedUrl.current = buildUrl(base.activeTab, base.tabs[base.activeTab]?.selectedItemId, base.tabs[base.activeTab])
      dispatch({ type: "SET_STATE", state: base })
    })()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced persistence
  useEffect(() => {
    if (!state._initialized) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveNavigationState(state)
    }, 100)
    return () => clearTimeout(saveTimer.current)
  }, [state])

  // Declarative state → URL sync
  const activeTabState = state.tabs[state.activeTab]
  const activeSelectedId = activeTabState?.selectedItemId
  useEffect(() => {
    if (!state._initialized) return
    const url = buildUrl(state.activeTab, activeSelectedId, activeTabState)
    if (url !== lastNavigatedUrl.current) {
      lastNavigatedUrl.current = url
      navigate(url)
    }
  }, [state.activeTab, activeSelectedId, activeTabState, navigate]) // eslint-disable-line react-hooks/exhaustive-deps

  // URL → state sync (browser back/forward and sidebar links)
  useEffect(() => {
    if (!state._initialized) return
    if (location.pathname === lastNavigatedUrl.current) return
    lastNavigatedUrl.current = location.pathname

    const parsed = parseUrl(location.pathname)
    const currentState = stateRef.current

    // For recent:* tabs, reuse existing tab state or create fresh
    if (parsed.tabId.startsWith("recent:")) {
      if (currentState.tabs[parsed.tabId] && currentState.activeTab === parsed.tabId) return
      const newTabs = { ...currentState.tabs }
      if (!newTabs[parsed.tabId]) {
        newTabs[parsed.tabId] = createRecentTabState(parsed)
      }
      dispatch({ type: "SET_STATE", state: { ...currentState, activeTab: parsed.tabId, tabs: newTabs } })
      return
    }

    if (parsed.tabId !== currentState.activeTab) {
      dispatch({ type: "SWITCH_TAB", tabId: parsed.tabId })
    }
    const currentSelectedId = currentState.tabs[currentState.activeTab]?.selectedItemId
    if (parsed.selectedId && parsed.selectedId !== currentSelectedId) {
      dispatch({ type: "SELECT_ITEM", itemId: parsed.selectedId })
    } else if (!parsed.selectedId && currentSelectedId) {
      dispatch({ type: "DESELECT_ITEM" })
    }
    if (parsed.sessionId) {
      dispatch({ type: "OPEN_SESSION", sessionId: parsed.sessionId })
    }
  }, [location.pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <NavigationContext.Provider value={{ state, dispatch }}>
      {children}
    </NavigationContext.Provider>
  )
}
