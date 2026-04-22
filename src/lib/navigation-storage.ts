// src/lib/navigation-storage.ts
import { del, get, set } from "idb-keyval"
import type { NavigationState } from "@/types/navigation"
import { createDefaultTabState } from "@/types/navigation"

const STORAGE_KEY = "INBOX_NAV_STATE"
const VERSION_KEY = "INBOX_NAV_STATE_VERSION"
const CURRENT_VERSION = 3

/** Strip empty-string values and return undefined if nothing remains. */
export function cleanFilters(
  filters: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!filters) return undefined
  const nonEmpty = Object.fromEntries(
    Object.entries(filters).filter(([, v]) => v !== ""),
  )
  return Object.keys(nonEmpty).length > 0 ? nonEmpty : undefined
}

export async function saveNavigationState(state: NavigationState): Promise<void> {
  const { _initialized, ...rest } = state
  await set(STORAGE_KEY, rest)
  await set(VERSION_KEY, CURRENT_VERSION)
}

export async function loadNavigationState(): Promise<NavigationState | null> {
  try {
    const storedVersion = (await get<number>(VERSION_KEY)) ?? 1
    if (storedVersion < CURRENT_VERSION) {
      await del(STORAGE_KEY)
      await set(VERSION_KEY, CURRENT_VERSION)
      return null
    }
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
  const validTypes = new Set(["list", "detail", "session", "artifact", "ask_user", "output", "code_editor", "compose", "settings"])

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
      activeFilters: cleanFilters(tabState.activeFilters),
    }
    // Ensure at least a list panel for plugin and session tabs
    if (tabId.startsWith("plugin:") || tabId === "sessions") {
      if (cleaned.panels.length === 0 || cleaned.panels[0]?.type !== "list") {
        cleaned.panels = [{ id: "list", type: "list", props: {} }, ...cleaned.panels]
      }
    }
    state.tabs[tabId] = cleaned
  }

  // Ensure sessions tab exists
  if (!state.tabs.sessions) {
    state.tabs.sessions = createDefaultTabState()
  }

  return state
}

