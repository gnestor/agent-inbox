// src/types/navigation.ts

// --- Tab identification ---

/** Tab IDs: plugin sources + sessions + settings + recent sessions */
export type TabId = "sessions" | "settings" | `plugin:${string}` | `recent:${string}`

/** Ordered tabs for animation direction calculation (settings = 0, then plugins in manifest order, sessions last) */
export const STATIC_TAB_ORDER: TabId[] = ["sessions"]

// --- Panel state (discriminated union) ---

export type PanelState =
  | { id: string; type: "list"; props: Record<string, never> }
  | { id: string; type: "detail"; props: { itemId: string } }
  | { id: string; type: "session"; props: { sessionId: string; linkedItemId?: string } }
  | { id: string; type: "new_session"; props: { sourceType?: string; sourceId?: string } }
  | { id: string; type: "output"; props: { sessionId: string; sequence: number; outputType: string; spec: import("@/components/session/OutputRenderer").OutputSpec } }
  | { id: string; type: "code_editor"; props: { sessionId: string; sequence: number; initialCode: string; artifactPanelId: string } }
  | { id: string; type: "ask_user"; props: { sessionId: string; sequence: number; questions: any[]; resultText: string } }
  | { id: string; type: "compose"; props: { threadId: string; draftBody?: string } }
  | { id: string; type: "settings"; props: Record<string, never> }

export type PanelType = PanelState["type"]

/** Singleton panel for the new-session compose form */
export const NEW_SESSION_PANEL: PanelState = { id: "new_session", type: "new_session", props: {} }

export function makeNewSessionPanel(source?: { type: string; id: string }): PanelState {
  return { id: "new_session", type: "new_session", props: source ? { sourceType: source.type, sourceId: source.id } : {} }
}

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
  /** Extra panels (position 2+) saved per item, restored on re-selection */
  savedPanels?: Record<string, PanelState[]>
  /** Animation hint: "item" for item selection transitions, "none" for panel push/pop */
  panelTransition?: "item" | "none"
  /** For recent:* tabs — the source tab that spawned this */
  sourceTab?: TabId
  /** For recent:* tabs — position in the sidebar list (for animation direction) */
  sidebarIndex?: number
}

// --- Full navigation state ---

export interface NavigationState {
  activeTab: TabId
  tabs: Record<string, TabState>  // string key to support dynamic plugin:* tabs
}

// --- Helpers ---

/** Extract the plugin ID from a `plugin:*` tab ID, or undefined if not a plugin tab */
export function pluginIdFromTab(tabId: string): string | undefined {
  return tabId.startsWith("plugin:") ? tabId.slice("plugin:".length) : undefined
}

export function createDefaultTabState(): TabState {
  return {
    panelScrollOffset: 0,
    panels: [{ id: "list", type: "list", props: {} }],
  }
}

export function createDefaultNavigationState(): NavigationState {
  return {
    activeTab: "plugin:gmail",
    tabs: {
      "plugin:gmail": createDefaultTabState(),
      "plugin:notion-tasks": createDefaultTabState(),
      "plugin:notion-calendar": createDefaultTabState(),
      sessions: createDefaultTabState(),
      settings: {
        panelScrollOffset: 0,
        panels: [{ id: "settings", type: "settings", props: {} }],
      },
    },
  }
}

// --- Backward compat: map legacy tab IDs to new plugin:* format ---

/** Maps legacy URL path / tab ID to new plugin:* tab ID */
export const LEGACY_TAB_MAP: Record<string, TabId> = {
  emails: "plugin:gmail",
  tasks: "plugin:notion-tasks",
  calendar: "plugin:notion-calendar",
}

/** Maps legacy URL paths to plugin IDs (for URL parsing) */
export const LEGACY_URL_TO_PLUGIN: Record<string, string> = {
  emails: "gmail",
  tasks: "notion-tasks",
  calendar: "notion-calendar",
}

/** Convert a legacy tab ID to the new format, or return as-is if already new format */
export function normalizeTabId(tabId: string): TabId {
  return LEGACY_TAB_MAP[tabId] ?? tabId as TabId
}

/**
 * Get the index of a tab for animation direction.
 * Order: settings (0) → plugins (1+, in order) → sessions (last)
 */
export function getTabIndex(tabId: TabId): number {
  if (tabId === "settings") return 0
  if (tabId === "sessions") return 100
  if (tabId.startsWith("plugin:")) {
    // Built-in plugins first, then external, then recent
    const id = pluginIdFromTab(tabId)!
    const builtinOrder = ["gmail", "notion-tasks", "notion-calendar"]
    const idx = builtinOrder.indexOf(id)
    if (idx >= 0) return idx + 1
    return 50 // external plugins
  }
  if (tabId.startsWith("recent:")) return 99
  return 50
}
