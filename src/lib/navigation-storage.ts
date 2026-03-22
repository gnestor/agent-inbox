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

/** Remove panels with unknown types, ensure all static tabs exist */
function validateState(state: NavigationState): NavigationState {
  // new_session is intentionally excluded — transient panel that shouldn't persist across reloads
  const validTypes = new Set(["list", "detail", "session", "artifact", "compose", "settings"])

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
    state.tabs[tabId] = {
      ...tabState,
      panels: tabState.panels.filter((p) => validTypes.has(p.type)),
    }
    // Ensure at least a list panel for source tabs
    if (["emails", "tasks", "calendar", "sessions"].includes(tabId)) {
      if (tabState.panels.length === 0 || tabState.panels[0].type !== "list") {
        tabState.panels.unshift({ id: "list", type: "list", props: {} })
      }
    }
  }

  // Ensure all static tabs exist
  for (const tabId of ["emails", "tasks", "calendar", "sessions"]) {
    if (!state.tabs[tabId]) {
      state.tabs[tabId] = createDefaultTabState()
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
    if (firstSegment === "inbox") state.activeTab = "emails"
    else if (["emails", "tasks", "calendar", "sessions"].includes(firstSegment)) {
      state.activeTab = firstSegment as any
    }

    // Convert per-tab state
    for (const tabId of ["emails", "tasks", "calendar", "sessions"] as const) {
      const oldTab = old.tabs[tabId]
      if (!oldTab) continue

      const panels: any[] = [{ id: "list", type: "list", props: {} }]

      if (oldTab.selectedId) {
        state.tabs[tabId].selectedItemId = oldTab.selectedId
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

      state.tabs[tabId].panels = panels
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
