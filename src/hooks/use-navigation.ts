// src/hooks/use-navigation.ts
import { useContext, useCallback, useRef } from "react"
import { NavigationContext, buildUrl } from "@/components/navigation/NavigationProvider"
import type { PanelState, TabId } from "@/types/navigation"

export function useNavigation() {
  const ctx = useContext(NavigationContext)
  if (!ctx) throw new Error("useNavigation must be used within NavigationProvider")

  const { state, dispatch, navigateAction, itemDirectionRef } = ctx

  const switchTab = useCallback(
    (tabId: TabId) => {
      dispatch({ type: "SWITCH_TAB", tabId })
      const selectedId = state.tabs[tabId]?.selectedItemId
      navigateAction(buildUrl(tabId, selectedId))
    },
    [dispatch, navigateAction, state.tabs],
  )

  // Track previous list index to compute direction
  const prevListIndexRef = useRef(0)

  const selectItem = useCallback(
    (itemId: string, listIndex?: number) => {
      if (listIndex !== undefined) {
        itemDirectionRef.current = listIndex > prevListIndexRef.current ? 1 : listIndex < prevListIndexRef.current ? -1 : 1
        prevListIndexRef.current = listIndex
      }
      dispatch({ type: "SELECT_ITEM", itemId, listIndex })
      navigateAction(buildUrl(state.activeTab, itemId))
    },
    [dispatch, navigateAction, state.activeTab, itemDirectionRef],
  )

  const deselectItem = useCallback(
    () => {
      dispatch({ type: "DESELECT_ITEM" })
      navigateAction(buildUrl(state.activeTab))
    },
    [dispatch, navigateAction, state.activeTab],
  )

  const pushPanel = useCallback(
    (panel: PanelState) => dispatch({ type: "PUSH_PANEL", panel }),
    [dispatch],
  )

  const popPanel = useCallback(
    (panelId: string) => dispatch({ type: "POP_PANEL", panelId }),
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

  const setFilter = useCallback(
    (key: string, value: string) => dispatch({ type: "SET_FILTER", key, value }),
    [dispatch],
  )

  const clearFilters = useCallback(
    () => dispatch({ type: "CLEAR_FILTERS" }),
    [dispatch],
  )

  return {
    activeTab: state.activeTab,
    switchTab,
    selectItem,
    deselectItem,
    pushPanel,
    popPanel,
    replacePanel,
    openSession,
    getPanels,
    getSelectedItemId,
    activeFilters: state.tabs[state.activeTab]?.activeFilters ?? {},
    setFilter,
    clearFilters,
  }
}
