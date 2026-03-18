// src/components/navigation/NavigationProvider.tsx
import { createContext, useEffect, useRef, useReducer, type ReactNode } from "react"
import { useNavigate, useLocation } from "react-router-dom"
import type { NavigationState, PanelState, TabId, TabState } from "@/types/navigation"
import { createDefaultNavigationState, createDefaultTabState } from "@/types/navigation"
import { saveNavigationState, loadNavigationState, migrateFromLocalStorage } from "@/lib/navigation-storage"

// --- URL helper ---

export function buildUrl(activeTab: TabId, selectedItemId?: string): string {
  if (activeTab === "settings") return "/settings/integrations"
  if (activeTab.startsWith("plugin:")) return `/plugins/${activeTab.replace("plugin:", "")}`
  return selectedItemId
    ? `/${activeTab}/${encodeURIComponent(selectedItemId)}`
    : `/${activeTab}`
}

// --- Actions ---

export type NavAction =
  | { type: "SET_STATE"; state: NavigationState }
  | { type: "SWITCH_TAB"; tabId: TabId }
  | { type: "SELECT_ITEM"; itemId: string; listIndex?: number }
  | { type: "DESELECT_ITEM" }
  | { type: "PUSH_PANEL"; panel: PanelState }
  | { type: "POP_PANEL"; panelId: string }
  | { type: "REPLACE_PANEL"; panelId: string; newPanel: PanelState }
  | { type: "OPEN_SESSION"; sessionId?: string }
  | { type: "SET_FILTER"; key: string; value: string }
  | { type: "CLEAR_FILTERS" }

function getOrCreateTab(state: NavigationState, tabId: TabId): TabState {
  return state.tabs[tabId] ?? createDefaultTabState()
}

function navReducer(state: NavigationState, action: NavAction): NavigationState {
  switch (action.type) {
    case "SET_STATE":
      return action.state

    case "SWITCH_TAB":
      return { ...state, activeTab: action.tabId }

    case "SELECT_ITEM": {
      const tab = { ...getOrCreateTab(state, state.activeTab) }
      tab.selectedItemId = action.itemId

      // Compute direction from list index
      if (action.listIndex !== undefined) {
        const prev = tab.prevListIndex ?? 0
        tab.itemDirection = action.listIndex > prev ? 1 : action.listIndex < prev ? -1 : 1
        tab.prevListIndex = action.listIndex
      }

      // If panels[1] is a detail panel, replace it and remove panels after
      if (tab.panels.length > 1 && tab.panels[1].type === "detail") {
        tab.panels = [
          tab.panels[0],
          { id: `detail:${action.itemId}`, type: "detail", props: { itemId: action.itemId } },
        ]
      } else {
        // Push detail at position 1
        tab.panels = [
          ...tab.panels.slice(0, 1),
          { id: `detail:${action.itemId}`, type: "detail", props: { itemId: action.itemId } },
        ]
      }

      return { ...state, tabs: { ...state.tabs, [state.activeTab]: tab } }
    }

    case "DESELECT_ITEM": {
      const tab = { ...getOrCreateTab(state, state.activeTab) }
      tab.selectedItemId = undefined
      tab.panels = tab.panels.slice(0, 1) // keep only list
      return { ...state, tabs: { ...state.tabs, [state.activeTab]: tab } }
    }

    case "PUSH_PANEL": {
      const tab = { ...getOrCreateTab(state, state.activeTab) }
      // Don't push duplicates
      if (tab.panels.some((p) => p.id === action.panel.id)) return state
      tab.panels = [...tab.panels, action.panel]
      return { ...state, tabs: { ...state.tabs, [state.activeTab]: tab } }
    }

    case "POP_PANEL": {
      const tab = { ...getOrCreateTab(state, state.activeTab) }
      const idx = tab.panels.findIndex((p) => p.id === action.panelId)
      if (idx >= 0) {
        // Truncate from this panel's position — removes it and everything after it
        tab.panels = tab.panels.slice(0, idx)
        // If the truncation removed the detail panel, clear selectedItemId
        if (!tab.panels.some((p) => p.type === "detail")) {
          tab.selectedItemId = undefined
        }
      }
      return { ...state, tabs: { ...state.tabs, [state.activeTab]: tab } }
    }

    case "REPLACE_PANEL": {
      const tab = { ...getOrCreateTab(state, state.activeTab) }
      tab.panels = tab.panels.map((p) => (p.id === action.panelId ? action.newPanel : p))
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
      // Replace existing session panel or push
      const existingIdx = tab.panels.findIndex((p) => p.type === "session")
      if (existingIdx >= 0) {
        tab.panels = [...tab.panels]
        tab.panels[existingIdx] = sessionPanel
      } else {
        tab.panels = [...tab.panels, sessionPanel]
      }
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
  const [state, dispatch] = useReducer(navReducer, createDefaultNavigationState())
  const navigate = useNavigate()
  const location = useLocation()
  const initialized = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Tracks the last URL we programmatically navigated to, so the URL→state
  // effect can distinguish our navigations from browser back/forward.
  const lastNavigatedUrl = useRef(location.pathname)

  // Load state from storage on mount
  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    ;(async () => {
      let loaded = await loadNavigationState()
      if (!loaded) {
        loaded = await migrateFromLocalStorage()
      }
      if (loaded) {
        dispatch({ type: "SET_STATE", state: loaded })
        const tab = loaded.tabs[loaded.activeTab]
        const selectedId = tab?.selectedItemId
        const url = buildUrl(loaded.activeTab, selectedId)
        lastNavigatedUrl.current = url
        navigate(url, { replace: true })
      }
    })()
  }, [navigate])

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
  // Derives URL from state and navigates when it differs from the current URL.
  const activeSelectedId = state.tabs[state.activeTab]?.selectedItemId
  useEffect(() => {
    if (!initialized.current) return
    const url = buildUrl(state.activeTab, activeSelectedId)
    if (url !== lastNavigatedUrl.current) {
      lastNavigatedUrl.current = url
      navigate(url)
    }
  }, [state.activeTab, activeSelectedId, navigate])

  // URL → state sync (browser back/forward ONLY)
  // When the URL changes due to our state→URL effect, lastNavigatedUrl matches,
  // so this effect skips. When it changes due to browser back/forward,
  // lastNavigatedUrl won't match, so we parse the URL and dispatch.
  useEffect(() => {
    if (!initialized.current) return
    if (location.pathname === lastNavigatedUrl.current) return
    lastNavigatedUrl.current = location.pathname

    const parts = location.pathname.split("/").filter(Boolean)
    let tabId: TabId = "emails"
    let selectedId: string | undefined

    if (parts[0] === "settings") tabId = "settings"
    else if (parts[0] === "plugins" && parts[1]) tabId = `plugin:${parts[1]}` as TabId
    else if (["emails", "tasks", "calendar", "sessions"].includes(parts[0])) {
      tabId = parts[0] as TabId
      if (parts[1]) selectedId = decodeURIComponent(parts[1])
    }

    if (tabId !== state.activeTab) {
      dispatch({ type: "SWITCH_TAB", tabId })
    }
    const currentSelectedId = state.tabs[state.activeTab]?.selectedItemId
    if (selectedId && selectedId !== currentSelectedId) {
      dispatch({ type: "SELECT_ITEM", itemId: selectedId })
    } else if (!selectedId && currentSelectedId) {
      dispatch({ type: "DESELECT_ITEM" })
    }
  }, [location.pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <NavigationContext.Provider value={{ state, dispatch }}>
      {children}
    </NavigationContext.Provider>
  )
}
