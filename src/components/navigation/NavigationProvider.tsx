// src/components/navigation/NavigationProvider.tsx
import { createContext, useEffect, useRef, useReducer, type ReactNode } from "react"
import { useNavigate, useLocation } from "react-router-dom"
import type { NavigationState, PanelState, TabId, TabState } from "@/types/navigation"
import { createDefaultNavigationState, createDefaultTabState, NEW_SESSION_PANEL } from "@/types/navigation"
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

    case "REMOVE_PANEL": {
      const tab = { ...getOrCreateTab(state, state.activeTab) }
      tab.panels = tab.panels.filter((p) => p.id !== action.panelId)
      if (!tab.panels.some((p) => p.type === "detail")) {
        tab.selectedItemId = undefined
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
  const [state, dispatch] = useReducer(navReducer, createDefaultNavigationState())
  const navigate = useNavigate()
  const location = useLocation()
  const initialized = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Keep a ref to the latest state so the URL→state effect (which intentionally
  // omits `state` from its deps) can read fresh values instead of stale closures.
  const stateRef = useRef(state)
  stateRef.current = state

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
  // Uses stateRef to read the latest state without adding `state` as a dependency.
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
  }, [location.pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <NavigationContext.Provider value={{ state, dispatch }}>
      {children}
    </NavigationContext.Provider>
  )
}
