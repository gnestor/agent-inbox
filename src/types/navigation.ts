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
  | { id: string; type: "session"; props: { sessionId: string; linkedItemId?: string } }
  | { id: string; type: "new_session"; props: Record<string, never> }
  | { id: string; type: "artifact"; props: { sessionId: string; sequence: number; outputType: string } }
  | { id: string; type: "compose"; props: { threadId: string; draftBody?: string } }
  | { id: string; type: "settings"; props: Record<string, never> }
  | { id: string; type: "new_session"; props: Record<string, never> }

export type PanelType = PanelState["type"]

/** Singleton panel for the new-session compose form */
export const NEW_SESSION_PANEL: PanelState = { id: "new_session", type: "new_session", props: {} }

// --- Per-tab state ---

export interface TabState {
  selectedItemId?: string
  panelScrollOffset: number
  panels: PanelState[]
  activeFilters?: Record<string, string>
  /** Direction of the last item selection: 1 = down, -1 = up */
  itemDirection?: number
  /** List index of the last selected item (for computing direction) */
  prevListIndex?: number
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

/**
 * Get the index of a tab for animation direction.
 * Order: settings (0) → emails (1) → tasks (2) → calendar (3) → sessions (4) → plugins (5+)
 */
export function getTabIndex(tabId: TabId): number {
  if (tabId === "settings") return 0
  const staticIdx = STATIC_TAB_ORDER.indexOf(tabId)
  if (staticIdx >= 0) return staticIdx + 1 // offset by 1 since settings is 0
  // Plugin tabs come after all static tabs
  return STATIC_TAB_ORDER.length + 1
}
