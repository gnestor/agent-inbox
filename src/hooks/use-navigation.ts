// src/hooks/use-navigation.ts
//
// Backward-compatible wrapper around the Zustand navigation store.
// Returns the same interface as the old Context-based hook so existing
// consumers work without changes during incremental migration.
//
// New code should prefer the granular hooks from navigation-store.ts:
//   useActiveTab, useTabPanels, useSelectedItemId, useNavActions, etc.

import {
  useNavigationStore,
  useActiveTab,
  useNavActions,
} from "@/lib/navigation-store"
import type { PanelState, TabId } from "@/types/navigation"

export function useNavigation() {
  const activeTab = useActiveTab()
  const {
    switchTab, selectItem, deselectItem, pushPanel, popPanel,
    removePanel, replacePanel, openSession, openNewSession,
    openRecent, setFilter, clearFilters,
  } = useNavActions()

  // Read full state for getter functions (backward compat)
  const tabs = useNavigationStore((s) => s.tabs)

  const getPanels = (tab?: TabId): PanelState[] => {
    const tabId = tab ?? activeTab
    return tabs[tabId]?.panels ?? []
  }

  const getSelectedItemId = (tab?: TabId): string | undefined => {
    const tabId = tab ?? activeTab
    return tabs[tabId]?.selectedItemId
  }

  const getItemDirection = (tab?: TabId): number => {
    const tabId = tab ?? activeTab
    return tabs[tabId]?.itemDirection ?? 1
  }

  const getPanelTransition = (tab?: TabId): "item" | "none" => {
    const tabId = tab ?? activeTab
    return tabs[tabId]?.panelTransition ?? "none"
  }

  const getSourceTab = (tab?: TabId): TabId | undefined => {
    const tabId = tab ?? activeTab
    return tabs[tabId]?.sourceTab
  }

  const getFilters = (tab?: TabId): Record<string, string> => {
    const tabId = tab ?? activeTab
    return tabs[tabId]?.activeFilters ?? {}
  }

  return {
    activeTab,
    switchTab,
    selectItem,
    deselectItem,
    pushPanel,
    popPanel,
    removePanel,
    replacePanel,
    openSession,
    openNewSession,
    openRecent,
    setFilter,
    clearFilters,
    getPanels,
    getSelectedItemId,
    getItemDirection,
    getPanelTransition,
    getSourceTab,
    activeFilters: tabs[activeTab]?.activeFilters ?? {},
    getFilters,
  }
}
