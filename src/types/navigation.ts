// src/types/navigation.ts

// --- Tab identification ---

/** Static tabs + dynamic plugin tabs */
export type TabId = "emails" | "tasks" | "calendar" | "sessions" | "settings" | `plugin:${string}`

/** Ordered tabs for animation direction calculation */
export const STATIC_TAB_ORDER: TabId[] = ["emails", "tasks", "calendar", "sessions"]

// --- Panel state (discriminated union) ---

export type PanelState =
  | { id: string; type: "list"; props: Record<string, never> }
  | { id: string; type: "detail"; props: { itemId: string } }
  | { id: string; type: "session"; props: { sessionId: string } }
  | { id: string; type: "artifact"; props: { sessionId: string; sequence: number; outputType: string } }
  | { id: string; type: "compose"; props: { threadId: string; draftBody?: string } }
  | { id: string; type: "settings"; props: Record<string, never> }

export type PanelType = PanelState["type"]

// --- Per-tab state ---

export interface TabState {
  selectedItemId?: string
  panelScrollOffset: number
  panels: PanelState[]
  activeFilters?: Record<string, string>
}

// --- Full navigation state ---

export interface NavigationState {
  activeTab: TabId
  tabs: Record<string, TabState>  // string key to support dynamic plugin:* tabs
}

// --- Helpers ---

export function createDefaultTabState(): TabState {
  return {
    panelScrollOffset: 0,
    panels: [{ id: "list", type: "list", props: {} }],
  }
}

export function createDefaultNavigationState(): NavigationState {
  return {
    activeTab: "emails",
    tabs: {
      emails: createDefaultTabState(),
      tasks: createDefaultTabState(),
      calendar: createDefaultTabState(),
      sessions: createDefaultTabState(),
      settings: {
        panelScrollOffset: 0,
        panels: [{ id: "settings", type: "settings", props: {} }],
      },
    },
  }
}

/** Get the index of a tab for animation direction. Plugin tabs come after static tabs. */
export function getTabIndex(tabId: TabId): number {
  const staticIdx = STATIC_TAB_ORDER.indexOf(tabId)
  if (staticIdx >= 0) return staticIdx
  if (tabId === "settings") return STATIC_TAB_ORDER.length
  // Plugin tabs: hash the id to get a stable position after settings
  return STATIC_TAB_ORDER.length + 1
}
