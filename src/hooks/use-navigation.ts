// src/hooks/use-navigation.ts
import { useContext, useCallback } from "react"
import { NavigationContext } from "@/components/navigation/NavigationProvider"
import type { PanelState, TabId } from "@/types/navigation"

export function useNavigation() {
  const ctx = useContext(NavigationContext)
  if (!ctx) throw new Error("useNavigation must be used within NavigationProvider")

  const { state, dispatch } = ctx

  const switchTab = useCallback(
    (tabId: TabId) => dispatch({ type: "SWITCH_TAB", tabId }),
    [dispatch],
  )

  const selectItem = useCallback(
    (itemId: string, listIndex?: number) => {
      dispatch({ type: "SELECT_ITEM", itemId, listIndex })
    },
    [dispatch],
  )

  const deselectItem = useCallback(
    () => dispatch({ type: "DESELECT_ITEM" }),
    [dispatch],
  )

  const pushPanel = useCallback(
    (panel: PanelState) => dispatch({ type: "PUSH_PANEL", panel }),
    [dispatch],
  )

  const popPanel = useCallback(
    (panelId: string) => dispatch({ type: "POP_PANEL", panelId }),
    [dispatch],
  )

  const removePanel = useCallback(
    (panelId: string) => dispatch({ type: "REMOVE_PANEL", panelId }),
    [dispatch],
  )

  const replacePanel = useCallback(
    (panelId: string, newPanel: PanelState) => dispatch({ type: "REPLACE_PANEL", panelId, newPanel }),
    [dispatch],
  )

  const openSession = useCallback(
    (sessionId?: string) => dispatch({ type: "OPEN_SESSION", sessionId }),
    [dispatch],
  )

  const openNewSession = useCallback(
    () => dispatch({ type: "OPEN_NEW_SESSION" }),
    [dispatch],
  )

  const getPanels = useCallback(
    (tab?: TabId) => {
      const tabId = tab ?? state.activeTab
      return state.tabs[tabId]?.panels ?? []
    },
    [state],
  )

  const getSelectedItemId = useCallback(
    (tab?: TabId) => {
      const tabId = tab ?? state.activeTab
      return state.tabs[tabId]?.selectedItemId
    },
    [state],
  )

  const getItemDirection = useCallback(
    (tab?: TabId) => {
      const tabId = tab ?? state.activeTab
      return state.tabs[tabId]?.itemDirection ?? 1
    },
    [state],
  )

  const setFilter = useCallback(
    (key: string, value: string) => dispatch({ type: "SET_FILTER", key, value }),
    [dispatch],
  )

  const clearFilters = useCallback(
    () => dispatch({ type: "CLEAR_FILTERS" }),
    [dispatch],
  )

  const getFilters = useCallback(
    (tab?: TabId) => {
      const tabId = tab ?? state.activeTab
      return state.tabs[tabId]?.activeFilters ?? {}
    },
    [state],
  )

  return {
    activeTab: state.activeTab,
    switchTab,
    selectItem,
    deselectItem,
    pushPanel,
    popPanel,
    removePanel,
    replacePanel,
    openSession,
    openNewSession,
    getPanels,
    getSelectedItemId,
    getItemDirection,
    activeFilters: state.tabs[state.activeTab]?.activeFilters ?? {},
    getFilters,
    setFilter,
    clearFilters,
  }
}
