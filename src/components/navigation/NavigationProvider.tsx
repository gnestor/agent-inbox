// src/components/navigation/NavigationProvider.tsx
import { createContext, useEffect, useRef, useReducer, type ReactNode } from "react"
import { useNavigate, useLocation } from "react-router-dom"
import type { NavigationState, PanelState, TabId, TabState } from "@/types/navigation"
import { createDefaultNavigationState, createDefaultTabState, NEW_SESSION_PANEL } from "@/types/navigation"
import { saveNavigationState, loadNavigationState, migrateFromLocalStorage } from "@/lib/navigation-storage"

// --- URL helpers ---

export function buildUrl(activeTab: TabId, selectedItemId?: string): string {
  if (activeTab === "settings") return "/settings/integrations"
  if (activeTab.startsWith("plugin:")) return `/plugins/${activeTab.replace("plugin:", "")}`
  return selectedItemId
    ? `/${activeTab}/${encodeURIComponent(selectedItemId)}`
    : `/${activeTab}`
}

/** Parse a URL pathname into navigation intent. Pure function, no side effects. */
export function parseUrl(pathname: string): { tabId: TabId; selectedId?: string; sessionId?: string } {
  const parts = pathname.split("/").filter(Boolean)
  if (parts[0] === "recent") {
    // /recent/sessions/{sessionId}
    if (parts[1] === "sessions" && parts[2])
      return { tabId: "sessions", selectedId: decodeURIComponent(parts[2]) }
    // /recent/emails/{id}/session/{sessionId} or /recent/tasks/{id}/session/{sessionId}
    if (["emails", "tasks"].includes(parts[1]) && parts[2]) {
      const sessionId = parts[3] === "session" && parts[4] ? decodeURIComponent(parts[4]) : undefined
      return { tabId: parts[1] as TabId, selectedId: decodeURIComponent(parts[2]), sessionId }
    }
    return { tabId: "sessions" }
  }
  if (parts[0] === "settings") return { tabId: "settings" }
  if (parts[0] === "plugins" && parts[1]) return { tabId: `plugin:${parts[1]}` as TabId }
  if (["emails", "tasks", "calendar", "sessions"].includes(parts[0]))
    return { tabId: parts[0] as TabId, selectedId: parts[1] ? decodeURIComponent(parts[1]) : undefined }
  return { tabId: "emails" }
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
  | { type: "REPLACE_PANEL"; panelId: string; newPanel: PanelState }
  | { type: "OPEN_SESSION"; sessionId?: string }
  | { type: "OPEN_NEW_SESSION" }
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
      return action.state

    case "SWITCH_TAB":
      return { ...state, activeTab: action.tabId }

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
      if (tab.panels.some((p) => p.id === NEW_SESSION_PANEL.id)) return state
      tab.selectedItemId = undefined
      tab.panels = [tab.panels[0], NEW_SESSION_PANEL]
      return { ...state, tabs: { ...state.tabs, [state.activeTab]: tab } }
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
    const { tabId } = parseUrl(pathname)
    const base = createDefaultNavigationState()
    base.activeTab = tabId
    return base
  })
  const navigate = useNavigate()
  const mountStarted = useRef(false)
  const initialized = useRef(false)
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
      const { tabId, selectedId, sessionId } = parseUrl(location.pathname)

      // 2. Persisted state supplements (panel stacks, filters, scroll, savedPanels)
      let base = await loadNavigationState()
      if (!base) base = await migrateFromLocalStorage()
      if (!base) base = createDefaultNavigationState()

      // 3. Override activeTab and selectedItemId from URL
      base.activeTab = tabId
      const tab = base.tabs[tabId] ?? createDefaultTabState()
      if (selectedId) {
        tab.selectedItemId = selectedId
        const saved = tab.savedPanels?.[selectedId] ?? []
        tab.panels = [
          tab.panels[0] ?? { id: "list", type: "list", props: {} },
          { id: `detail:${selectedId}`, type: "detail", props: { itemId: selectedId } },
          ...saved,
        ]
        if (sessionId) {
          tab.panels = tab.panels.filter((p) => p.type !== "session")
          tab.panels.push({
            id: `session:${sessionId}`,
            type: "session",
            props: { sessionId, linkedItemId: selectedId },
          })
        }
      } else {
        tab.selectedItemId = undefined
        tab.panels = [tab.panels[0] ?? { id: "list", type: "list", props: {} }]
      }
      base.tabs[tabId] = tab

      // 4. Dispatch merged state; URL already correct, no navigate() needed
      dispatch({ type: "SET_STATE", state: base })
      lastNavigatedUrl.current = location.pathname
      initialized.current = true
    })()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced persistence
  useEffect(() => {
    if (!initialized.current) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveNavigationState(state)
    }, 100)
    return () => clearTimeout(saveTimer.current)
  }, [state])

  // Declarative state → URL sync
  // Don't override /recent/ routes — they are managed by sidebar links.
  const activeSelectedId = state.tabs[state.activeTab]?.selectedItemId
  useEffect(() => {
    if (!initialized.current) return
    if (location.pathname.startsWith("/recent/")) return
    const url = buildUrl(state.activeTab, activeSelectedId)
    if (url !== lastNavigatedUrl.current) {
      lastNavigatedUrl.current = url
      navigate(url)
    }
  }, [state.activeTab, activeSelectedId, navigate, location.pathname])

  // URL → state sync (browser back/forward and sidebar links)
  useEffect(() => {
    if (!initialized.current) return
    if (location.pathname === lastNavigatedUrl.current) return
    lastNavigatedUrl.current = location.pathname

    const { tabId, selectedId, sessionId } = parseUrl(location.pathname)

    const currentState = stateRef.current
    if (tabId !== currentState.activeTab) {
      dispatch({ type: "SWITCH_TAB", tabId })
    }
    const currentSelectedId = currentState.tabs[currentState.activeTab]?.selectedItemId
    if (selectedId && selectedId !== currentSelectedId) {
      dispatch({ type: "SELECT_ITEM", itemId: selectedId })
    } else if (!selectedId && currentSelectedId) {
      dispatch({ type: "DESELECT_ITEM" })
    }
    if (sessionId) {
      dispatch({ type: "OPEN_SESSION", sessionId })
    }
  }, [location.pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <NavigationContext.Provider value={{ state, dispatch }}>
      {children}
    </NavigationContext.Provider>
  )
}
