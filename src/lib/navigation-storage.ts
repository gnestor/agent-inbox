// src/lib/navigation-storage.ts
import { get, set } from "idb-keyval"
import type { NavigationState } from "@/types/navigation"
import { createDefaultNavigationState, createDefaultTabState, normalizeTabId, LEGACY_TAB_MAP } from "@/types/navigation"

const STORAGE_KEY = "INBOX_NAV_STATE"
const OLD_STORAGE_KEY = "spatial-nav-state"

// Static source plugin tabs that should always exist
const REQUIRED_TABS = ["plugin:gmail", "plugin:notion-tasks", "plugin:notion-calendar", "sessions"]

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

/** Remove panels with unknown types, ensure all static tabs exist, migrate legacy tab IDs */
function validateState(state: NavigationState): NavigationState {
  // new_session is intentionally excluded — transient panel that shouldn't persist across reloads
  const validTypes = new Set(["list", "detail", "session", "artifact", "code_editor", "compose", "settings"])

  // Migrate legacy tab IDs: emails → plugin:gmail, tasks → plugin:notion-tasks, calendar → plugin:notion-calendar
  const legacyIds = ["emails", "tasks", "calendar"]
  for (const oldId of legacyIds) {
    if (state.tabs[oldId]) {
      const newId = normalizeTabId(oldId)
      if (!state.tabs[newId]) {
        state.tabs[newId] = state.tabs[oldId]
      }
      delete state.tabs[oldId]
    }
  }

  // Normalize activeTab
  state.activeTab = normalizeTabId(state.activeTab)

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
    // Ensure at least a list panel for source/session tabs
    if (REQUIRED_TABS.includes(tabId)) {
      if (cleaned.panels.length === 0 || cleaned.panels[0].type !== "list") {
        cleaned.panels = [{ id: "list", type: "list", props: {} }, ...cleaned.panels]
      }
    }
    state.tabs[tabId] = cleaned
  }

  // Ensure all required tabs exist
  for (const tabId of REQUIRED_TABS) {
    if (!state.tabs[tabId]) {
      state.tabs[tabId] = createDefaultTabState()
    }
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
    const firstSegment = old.pathname.split("/").filter(Boolean)[0] || "emails"
    state.activeTab = normalizeTabId(firstSegment === "inbox" ? "emails" : firstSegment)

    const migrationMap = { ...LEGACY_TAB_MAP, sessions: "sessions" as const }

    for (const [oldTabId, newTabId] of Object.entries(migrationMap)) {
      const oldTab = old.tabs[oldTabId]
      if (!oldTab) continue

      const panels: any[] = [{ id: "list", type: "list", props: {} }]

      if (oldTab.selectedId) {
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
