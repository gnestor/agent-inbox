// src/lib/navigation-storage.ts
import { get, set } from "idb-keyval"
import type { NavigationState } from "@/types/navigation"
import { createDefaultNavigationState, createDefaultTabState } from "@/types/navigation"

const STORAGE_KEY = "INBOX_NAV_STATE"
const OLD_STORAGE_KEY = "spatial-nav-state"


// --- IndexedDB persistence ---

export async function saveNavigationState(state: NavigationState): Promise<void> {
  await set(STORAGE_KEY, state)
}

export async function loadNavigationState(): Promise<NavigationState | null> {
  try {
    const state = await get<NavigationState>(STORAGE_KEY)
    if (!state || !state.activeTab || !state.tabs) return null
    return validateState(state)
  } catch {
    return null
  }
}

/** Remove panels with unknown types, ensure sessions tab exists, migrate legacy tab IDs */
function validateState(state: NavigationState): NavigationState {
  // new_session is intentionally excluded — transient panel that shouldn't persist across reloads
  const validTypes = new Set(["list", "detail", "session", "output", "code_editor", "compose", "settings"])

  for (const [tabId, tabState] of Object.entries(state.tabs)) {
    // Validate savedPanels entries too
    if (tabState.savedPanels) {
      const cleaned: Record<string, typeof tabState.panels> = {}
      for (const [itemId, panels] of Object.entries(tabState.savedPanels)) {
        const valid = panels.filter((p) => validTypes.has(p.type))
        if (valid.length > 0) cleaned[itemId] = valid
      }
      tabState.savedPanels = Object.keys(cleaned).length > 0 ? cleaned : undefined
    }
    const cleaned = {
      ...tabState,
      panels: tabState.panels.filter((p) => validTypes.has(p.type)),
    }
    // Ensure at least a list panel for plugin and session tabs
    if (tabId.startsWith("plugin:") || tabId === "sessions") {
      if (cleaned.panels.length === 0 || cleaned.panels[0].type !== "list") {
        cleaned.panels = [{ id: "list", type: "list", props: {} }, ...cleaned.panels]
      }
    }
    state.tabs[tabId] = cleaned
  }

  // Ensure sessions tab exists
  if (!state.tabs.sessions) {
    state.tabs.sessions = createDefaultTabState()
  }

  // Clean up stale recent:* tabs (keep only the active one, if any)
  for (const tabId of Object.keys(state.tabs)) {
    if (tabId.startsWith("recent:") && tabId !== state.activeTab) {
      delete state.tabs[tabId]
    }
  }

  return state
}

// --- Migration from old localStorage format ---

interface OldSavedNavState {
  pathname: string
  tabs: Record<string, { selectedId?: string; sessionOpen?: boolean; sessionId?: string }>
  itemSessions?: Array<[string, { sessionOpen: boolean; sessionId?: string }]>
}

export async function migrateFromLocalStorage(): Promise<NavigationState | null> {
  try {
    const raw = localStorage.getItem(OLD_STORAGE_KEY)
    if (!raw) return null

    const old: OldSavedNavState = JSON.parse(raw)
    if (!old.pathname || !old.tabs) return null

    // Handle inbox → emails rename from old migration
    if ("inbox" in old.tabs && !("emails" in old.tabs)) {
      old.tabs.emails = old.tabs.inbox
      delete old.tabs.inbox
    }

    const state = createDefaultNavigationState()

    // Derive activeTab from pathname
    const firstSegment = old.pathname.split("/").filter(Boolean)[0] || "sessions"
    const nonPluginTabs = new Set(["sessions", "settings", "workspace-settings"])
    state.activeTab = (nonPluginTabs.has(firstSegment) ? firstSegment : `plugin:${firstSegment}`) as NavigationState["activeTab"]

    const migrationMap: Record<string, string> = { sessions: "sessions" }

    for (const [oldTabId, newTabId] of Object.entries(migrationMap)) {
      const oldTab = old.tabs[oldTabId]
      if (!oldTab) continue

      const panels: any[] = [{ id: "list", type: "list", props: {} }]

      if (oldTab.selectedId) {
        if (!state.tabs[newTabId]) state.tabs[newTabId] = createDefaultTabState()
        state.tabs[newTabId].selectedItemId = oldTab.selectedId
        panels.push({
          id: `detail:${oldTab.selectedId}`,
          type: "detail",
          props: { itemId: oldTab.selectedId },
        })

        if (oldTab.sessionOpen && oldTab.sessionId) {
          panels.push({
            id: `session:${oldTab.sessionId}`,
            type: "session",
            props: { sessionId: oldTab.sessionId },
          })
        }
      }

      if (!state.tabs[newTabId]) state.tabs[newTabId] = createDefaultTabState()
      state.tabs[newTabId].panels = panels
    }

    // Save to IndexedDB and remove old key
    await saveNavigationState(state)
    localStorage.removeItem(OLD_STORAGE_KEY)

    return state
  } catch {
    // Migration failed — clear old state and start fresh
    localStorage.removeItem(OLD_STORAGE_KEY)
    return null
  }
}
