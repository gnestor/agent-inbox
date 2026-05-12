// src/lib/navigation-store.ts
//
// Zustand store for navigation state. Replaces NavigationContext + useReducer
// with selective subscriptions so components only re-render when their slice changes.

import { create } from "zustand"
import { useShallow } from "zustand/shallow"
import type { NavigationState, PanelState, TabId, TabState } from "@/types/navigation"
import { createDefaultNavigationState, createDefaultTabState, makeNewSessionPanel } from "@/types/navigation"
import { cleanFilters } from "@/lib/navigation-storage"

// Stable empty arrays/objects for selector fallbacks — prevents new-reference infinite loops
const EMPTY_PANELS: PanelState[] = []
const EMPTY_FILTERS: Record<string, string> = {}

// --- Store shape ---

export interface NavigationStore extends NavigationState {
  // Actions (stable references — never recreated)
  switchTab: (tabId: TabId) => void
  selectItem: (itemId: string, listIndex?: number) => void
  deselectItem: () => void
  pushPanel: (panel: PanelState) => void
  popPanel: (panelId: string) => void
  removePanel: (panelId: string) => void
  replacePanel: (panelId: string, newPanel: PanelState, selectedItemId?: string) => void
  openSession: (sessionId?: string) => void
  openNewSession: (source?: { type: string; id: string; content?: string }) => void
  openRecent: (sessionId: string, sourceTab: TabId, selectedId: string | undefined, sidebarIndex: number) => void
  setFilter: (key: string, value: string) => void
  clearFilters: () => void
  /** Hydrate from persisted state (IndexedDB) on mount */
  _hydrate: (state: NavigationState) => void
}

// --- Helpers ---

function getOrCreateTab(tabs: Record<string, TabState>, tabId: TabId): TabState {
  return tabs[tabId] ?? createDefaultTabState()
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

/** Build an ephemeral tab state for a /recent/ route (no list panel). */
export function createRecentTabState(parsed: {
  tabId: TabId
  sourceTab?: TabId
  selectedId?: string
  sessionId?: string
}): TabState {
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
  }
  return {
    panelScrollOffset: 0,
    panels,
    sourceTab: parsed.sourceTab,
    selectedItemId: parsed.selectedId,
  }
}

// --- Store ---

const defaultState = createDefaultNavigationState()

export const useNavigationStore = create<NavigationStore>()((set) => ({
  // Initial state
  activeTab: defaultState.activeTab,
  tabs: defaultState.tabs,
  _initialized: false,

  // --- Actions (ported 1:1 from navReducer) ---

  switchTab: (tabId) => set((s) => {
    const tabs = s.tabs[tabId]
      ? s.tabs
      : { ...s.tabs, [tabId]: createDefaultTabState() }
    return { activeTab: tabId, tabs }
  }),

  selectItem: (itemId, listIndex) => set((s) => {
    const tab = { ...getOrCreateTab(s.tabs, s.activeTab) }
    saveExtraPanels(tab)

    tab.selectedItemId = itemId
    tab.panelTransition = "item"

    if (listIndex !== undefined) {
      const prev = tab.prevListIndex ?? 0
      tab.itemDirection = listIndex > prev ? 1 : listIndex < prev ? -1 : 1
      tab.prevListIndex = listIndex
    }

    const saved = tab.savedPanels?.[itemId] ?? []
    const listPanel = tab.panels[0] ?? { id: "list", type: "list" as const, props: {} }
    tab.panels = [
      listPanel,
      { id: `detail:${itemId}`, type: "detail", props: { itemId } },
      ...saved,
    ]

    return { tabs: { ...s.tabs, [s.activeTab]: tab } }
  }),

  deselectItem: () => set((s) => {
    const tab = { ...getOrCreateTab(s.tabs, s.activeTab) }
    saveExtraPanels(tab)
    tab.selectedItemId = undefined
    tab.panels = tab.panels.slice(0, 1)
    tab.panelTransition = "none"
    return { tabs: { ...s.tabs, [s.activeTab]: tab } }
  }),

  pushPanel: (panel) => set((s) => {
    const tab = { ...getOrCreateTab(s.tabs, s.activeTab) }
    if (tab.panels.some((p) => p.id === panel.id)) return s
    tab.panels = [...tab.panels, panel]
    tab.panelTransition = "none"
    return { tabs: { ...s.tabs, [s.activeTab]: tab } }
  }),

  popPanel: (panelId) => set((s) => {
    const tab = { ...getOrCreateTab(s.tabs, s.activeTab) }
    const idx = tab.panels.findIndex((p) => p.id === panelId)
    if (idx >= 0) {
      tab.panels = tab.panels.slice(0, idx)
      if (!tab.panels.some((p) => p.type === "detail")) {
        tab.selectedItemId = undefined
      }
    }
    tab.panelTransition = "none"
    return { tabs: { ...s.tabs, [s.activeTab]: tab } }
  }),

  removePanel: (panelId) => set((s) => {
    const tab = { ...getOrCreateTab(s.tabs, s.activeTab) }
    tab.panels = tab.panels.filter((p) => p.id !== panelId)
    if (!tab.panels.some((p) => p.type === "detail")) {
      tab.selectedItemId = undefined
    }
    tab.panelTransition = "none"
    return { tabs: { ...s.tabs, [s.activeTab]: tab } }
  }),

  replacePanel: (panelId, newPanel, selectedItemId) => set((s) => {
    const tab = { ...getOrCreateTab(s.tabs, s.activeTab) }
    tab.panels = tab.panels.map((p) => (p.id === panelId ? newPanel : p))
    if (selectedItemId !== undefined) tab.selectedItemId = selectedItemId
    tab.panelTransition = "none"
    return { tabs: { ...s.tabs, [s.activeTab]: tab } }
  }),

  openSession: (sessionId) => set((s) => {
    const tab = { ...getOrCreateTab(s.tabs, s.activeTab) }
    const sid = sessionId ?? "new"
    const sessionPanel: PanelState = {
      id: `session:${sid}`,
      type: "session",
      props: { sessionId: sid, linkedItemId: tab.selectedItemId },
    }
    const existingIdx = tab.panels.findIndex((p) => p.type === "session")
    if (existingIdx >= 0) {
      tab.panels = [...tab.panels]
      tab.panels[existingIdx] = sessionPanel
    } else {
      tab.panels = [...tab.panels, sessionPanel]
    }
    tab.panelTransition = "none"
    return { tabs: { ...s.tabs, [s.activeTab]: tab } }
  }),

  openNewSession: (source) => set((s) => {
    const tab = { ...getOrCreateTab(s.tabs, s.activeTab) }
    if (tab.panels.some((p) => p.id === "new_session")) return s
    const newSessionPanel = makeNewSessionPanel(source)
    if (source) {
      // From a detail view: keep list + detail, append new session
      const kept = tab.panels.filter((p) => p.type === "list" || p.type === "detail")
      tab.panels = [...kept, newSessionPanel]
    } else {
      // From the "+" button: close detail panels, show list + new session
      tab.selectedItemId = undefined
      tab.panels = [tab.panels[0] ?? { id: "list", type: "list", props: {} }, newSessionPanel]
    }
    tab.panelTransition = "none"
    return { tabs: { ...s.tabs, [s.activeTab]: tab } }
  }),

  openRecent: (sessionId, sourceTab, selectedId, sidebarIndex) => set((s) => {
    const tabId: TabId = `recent:${sessionId}`
    const existing = s.tabs[tabId]
    const hasSessionPanel = existing?.panels.some(
      (p) => p.type === "session" && p.props.sessionId === sessionId,
    )
    const tab = existing && hasSessionPanel
      ? { ...existing }
      : createRecentTabState({ tabId, sourceTab, selectedId, sessionId })

    const oldTab = s.activeTab.startsWith("recent:") ? s.tabs[s.activeTab] : undefined
    const oldIdx = oldTab?.sidebarIndex ?? -1
    tab.itemDirection = sidebarIndex > oldIdx ? 1 : sidebarIndex < oldIdx ? -1 : 1
    tab.sidebarIndex = sidebarIndex
    tab.panelTransition = "item"

    return { activeTab: tabId, tabs: { ...s.tabs, [tabId]: tab } }
  }),

  setFilter: (key, value) => set((s) => {
    const tab = { ...getOrCreateTab(s.tabs, s.activeTab) }
    tab.activeFilters = cleanFilters({ ...tab.activeFilters, [key]: value })
    return { tabs: { ...s.tabs, [s.activeTab]: tab } }
  }),

  clearFilters: () => set((s) => {
    const tab = { ...getOrCreateTab(s.tabs, s.activeTab) }
    tab.activeFilters = undefined
    return { tabs: { ...s.tabs, [s.activeTab]: tab } }
  }),

  _hydrate: (state) => set({ ...state, _initialized: true }),
}))

// --- Selector hooks ---

/** Returns the active tab ID. Only re-renders when activeTab changes. */
export function useActiveTab(): TabId {
  return useNavigationStore((s) => s.activeTab)
}

/** Returns panels for a tab. Defaults to activeTab. */
export function useTabPanels(tabId?: TabId): PanelState[] {
  return useNavigationStore((s) => {
    const id = tabId ?? s.activeTab
    return s.tabs[id]?.panels ?? EMPTY_PANELS
  })
}

/**
 * Returns panels for a tab, gated on hydration.
 * Before the store is rehydrated from IndexedDB, only "list" panels are
 * returned — UNLESS the URL-derived sync initialization already set up
 * detail panels (panels.length > 1), in which case they're correct and
 * should be shown immediately to avoid flashing.
 */
export function useHydratedPanels(tabId?: TabId): PanelState[] {
  return useNavigationStore(useShallow((s) => {
    const id = tabId ?? s.activeTab
    const panels = s.tabs[id]?.panels ?? EMPTY_PANELS
    if (s._initialized) return panels
    // If URL sync already set up detail panels, show them immediately
    if (panels.length > 1) return panels
    return panels.filter((p) => p.type === "list")
  }))
}

/** Returns selectedItemId for a tab. Defaults to activeTab. */
export function useSelectedItemId(tabId?: TabId): string | undefined {
  return useNavigationStore((s) => {
    const id = tabId ?? s.activeTab
    return s.tabs[id]?.selectedItemId
  })
}

/** Returns item direction for a tab. Defaults to activeTab. */
export function useItemDirection(tabId?: TabId): number {
  return useNavigationStore((s) => {
    const id = tabId ?? s.activeTab
    return s.tabs[id]?.itemDirection ?? 1
  })
}

/** Returns panel transition hint for a tab. Defaults to activeTab. */
export function usePanelTransition(tabId?: TabId): "item" | "none" {
  return useNavigationStore((s) => {
    const id = tabId ?? s.activeTab
    return s.tabs[id]?.panelTransition ?? "none"
  })
}

/** Returns active filters for a tab. Defaults to activeTab. Uses shallow comparison. */
export function useActiveFilters(tabId?: TabId): Record<string, string> {
  return useNavigationStore(useShallow((s) => {
    const id = tabId ?? s.activeTab
    return s.tabs[id]?.activeFilters ?? EMPTY_FILTERS
  }))
}

/** Returns source tab for a tab. Defaults to activeTab. */
export function useSourceTab(tabId?: TabId): TabId | undefined {
  return useNavigationStore((s) => {
    const id = tabId ?? s.activeTab
    return s.tabs[id]?.sourceTab
  })
}

/** Returns plugin:* tab keys from the store. Fallback for before plugins load. */
const EMPTY_STRINGS: string[] = []
export function useStorePluginKeys(): string[] {
  return useNavigationStore(useShallow((s) =>
    Object.keys(s.tabs).filter((k) => k.startsWith("plugin:"))
  )) ?? EMPTY_STRINGS
}

/** Returns all action functions. Stable references — never causes re-renders. */
export function useNavActions() {
  return useNavigationStore(useShallow((s) => ({
    switchTab: s.switchTab,
    selectItem: s.selectItem,
    deselectItem: s.deselectItem,
    pushPanel: s.pushPanel,
    popPanel: s.popPanel,
    removePanel: s.removePanel,
    replacePanel: s.replacePanel,
    openSession: s.openSession,
    openNewSession: s.openNewSession,
    openRecent: s.openRecent,
    setFilter: s.setFilter,
    clearFilters: s.clearFilters,
  })))
}
