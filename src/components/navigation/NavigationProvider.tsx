// src/components/navigation/NavigationProvider.tsx
import { createContext, useEffect, useRef, useReducer, type ReactNode } from "react"
import { useNavigate, useLocation } from "react-router-dom"
import type { NavigationState, PanelState, TabId, TabState } from "@/types/navigation"
import { createDefaultNavigationState, createDefaultTabState } from "@/types/navigation"
import { saveNavigationState, loadNavigationState, migrateFromLocalStorage } from "@/lib/navigation-storage"

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
        props: { sessionId },
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
  itemDirectionRef: React.RefObject<number>
}

export const NavigationContext = createContext<NavigationContextValue | null>(null)

// --- Provider ---

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(navReducer, createDefaultNavigationState())
  const navigate = useNavigate()
  const location = useLocation()
  const initialized = useRef(false)
  const itemDirectionRef = useRef(1)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

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
        // Navigate to the restored state's active tab
        const tab = loaded.tabs[loaded.activeTab]
        const selectedId = tab?.selectedItemId
        const url = selectedId
          ? `/${loaded.activeTab}/${encodeURIComponent(selectedId)}`
          : `/${loaded.activeTab}`
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

  // Sync URL → state (browser back/forward)
  const lastSyncedUrl = useRef(location.pathname)
  const urlDrivenChange = useRef(false) // true when state change was triggered by URL→state sync
  useEffect(() => {
    if (!initialized.current) return
    if (location.pathname === lastSyncedUrl.current) return
    lastSyncedUrl.current = location.pathname

    // Derive tab and selectedId from URL
    const parts = location.pathname.split("/").filter(Boolean)
    let tabId: TabId = "emails"
    let selectedId: string | undefined

    if (parts[0] === "settings") tabId = "settings"
    else if (parts[0] === "plugins" && parts[1]) tabId = `plugin:${parts[1]}` as TabId
    else if (["emails", "tasks", "calendar", "sessions"].includes(parts[0])) {
      tabId = parts[0] as TabId
      if (parts[1]) selectedId = decodeURIComponent(parts[1])
    }

    urlDrivenChange.current = true
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
  // Only re-run when URL changes, NOT when state changes (that would cause a loop)

  // Sync URL on activeTab / selectedItemId changes
  useEffect(() => {
    if (!initialized.current) return
    const tab = state.tabs[state.activeTab]
    const selectedId = tab?.selectedItemId
    let targetUrl: string
    if (state.activeTab === "settings") {
      targetUrl = "/settings/integrations"
    } else if (state.activeTab.startsWith("plugin:")) {
      targetUrl = `/plugins/${state.activeTab.replace("plugin:", "")}`
    } else {
      targetUrl = selectedId
        ? `/${state.activeTab}/${encodeURIComponent(selectedId)}`
        : `/${state.activeTab}`
    }
    if (location.pathname !== targetUrl) {
      lastSyncedUrl.current = targetUrl
      // Replace for URL-driven changes (browser back/forward) to avoid loop;
      // push for user-initiated actions (switchTab, selectItem, etc.)
      const replace = urlDrivenChange.current
      urlDrivenChange.current = false
      navigate(targetUrl, { replace })
    }
  }, [state.activeTab, state.tabs[state.activeTab]?.selectedItemId, navigate, location.pathname])

  return (
    <NavigationContext.Provider value={{ state, dispatch, itemDirectionRef }}>
      {children}
    </NavigationContext.Provider>
  )
}
