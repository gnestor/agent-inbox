# Phase 2.5A: Navigation Core — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the navigation state management system (NavigationProvider, useNavigation, Tab, Panel, PanelSlot) that replaces the monolithic PanelStack.tsx with composable components.

**Architecture:** A React context provider (`NavigationProvider`) manages a serializable `NavigationState` object persisted to IndexedDB via `idb-keyval`. Components (`Tab`, `Panel`, `PanelSlot`) read state via `useNavigation()` hook. URL is a read hint (encodes only activeTab + selectedItemId); full panel stack lives in storage. Animations use Framer Motion (same easing/duration as current system).

**Tech Stack:** React 19, TypeScript, Framer Motion, idb-keyval (already installed), react-router-dom

**Spec:** `packages/inbox/.plans/phase-2.5-navigation-redesign-spec.md`

---

## File Structure

```
src/
├── types/
│   └── navigation.ts                — NavigationState, TabState, PanelState, TabId, PanelType
├── lib/
│   ├── navigation-storage.ts        — IndexedDB persistence + migration from localStorage
│   └── navigation-constants.ts      — PANEL_CARD, EASE, DURATION (shared animation constants)
├── components/
│   └── navigation/
│       ├── NavigationProvider.tsx    — React context + state reducer + persistence + URL sync
│       ├── Tab.tsx                  — horizontal panel row + scroll management
│       ├── Panel.tsx                — thin card container (no logic)
│       ├── PanelSlot.tsx            — AnimatePresence wrapper for item transitions
│       └── PanelContent.tsx         — maps PanelState → React component (placeholder)
└── hooks/
    └── use-navigation.ts            — public hook (thin wrapper around context)
```

---

## Chunk 1: Types + Storage

### Task 1: Navigation type definitions

**Files:**
- Create: `src/types/navigation.ts`

- [ ] **Step 1: Create the types file**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add src/types/navigation.ts
git commit -m "feat: add navigation type definitions (NavigationState, TabState, PanelState)"
```

### Task 2: Navigation constants

**Files:**
- Create: `src/lib/navigation-constants.ts`

- [ ] **Step 1: Create constants file**

Extract shared animation constants from PanelStack.tsx (lines 27-28) so both old and new systems can use them.

```typescript
// src/lib/navigation-constants.ts

/** Cubic bezier easing for tab and item transitions */
export const EASE: [number, number, number, number] = [0.32, 0.72, 0, 1]

/** Duration in seconds for tab and item transitions */
export const DURATION = 0.6

/** Gap in pixels between panels during list item navigation */
export const ITEM_GAP = 16

/** Panel card styling class */
export const PANEL_CARD = "shrink-0 h-full w-[600px] bg-card rounded-lg shadow-sm ring-1 ring-inset ring-border overflow-hidden"

/** Default panel width in pixels */
export const DEFAULT_PANEL_WIDTH = 600
```

- [ ] **Step 2: Update PanelStack.tsx to import from constants**

In `src/components/layout/PanelStack.tsx`, replace the local constant definitions (lines 27-33) with imports:

```typescript
// Replace these lines:
// export const EASE: [number, number, number, number] = [0.32, 0.72, 0, 1]
// export const DURATION = 0.6
// const ITEM_GAP = 16
// export const PANEL_CARD = "shrink-0 ..."

// With:
import { EASE, DURATION, ITEM_GAP, PANEL_CARD } from "@/lib/navigation-constants"
export { EASE, DURATION, PANEL_CARD } // re-export for existing consumers
```

- [ ] **Step 3: Run tests**

Run: `cd packages/inbox && npm run test:ci`
Expected: PASS (no behavior change)

- [ ] **Step 4: Commit**

```bash
git add src/lib/navigation-constants.ts src/components/layout/PanelStack.tsx
git commit -m "refactor: extract navigation constants from PanelStack"
```

### Task 3: Navigation storage (IndexedDB persistence + migration)

**Files:**
- Create: `src/lib/navigation-storage.ts`
- Create: `src/lib/__tests__/navigation-storage.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/__tests__/navigation-storage.test.ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  saveNavigationState,
  loadNavigationState,
  migrateFromLocalStorage,
} from "../navigation-storage"
import type { NavigationState } from "@/types/navigation"
import { createDefaultNavigationState } from "@/types/navigation"

// Mock idb-keyval
const store = new Map<string, unknown>()
vi.mock("idb-keyval", () => ({
  get: vi.fn((key: string) => Promise.resolve(store.get(key))),
  set: vi.fn((key: string, value: unknown) => { store.set(key, value); return Promise.resolve() }),
  del: vi.fn((key: string) => { store.delete(key); return Promise.resolve() }),
}))

describe("navigation-storage", () => {
  beforeEach(() => {
    store.clear()
    localStorage.clear()
  })

  describe("saveNavigationState / loadNavigationState", () => {
    it("round-trips a navigation state", async () => {
      const state = createDefaultNavigationState()
      state.activeTab = "tasks"
      await saveNavigationState(state)
      const loaded = await loadNavigationState()
      expect(loaded).toEqual(state)
    })

    it("returns null when no state saved", async () => {
      const loaded = await loadNavigationState()
      expect(loaded).toBeNull()
    })
  })

  describe("migrateFromLocalStorage", () => {
    it("migrates old spatial-nav-state to new format", async () => {
      const oldState = {
        pathname: "/emails/abc123",
        tabs: {
          emails: { selectedId: "abc123", sessionOpen: true, sessionId: "sess1" },
          tasks: {},
          calendar: {},
          sessions: {},
        },
        itemSessions: [
          ["emails:abc123", { sessionOpen: true, sessionId: "sess1" }],
        ],
      }
      localStorage.setItem("spatial-nav-state", JSON.stringify(oldState))

      const migrated = await migrateFromLocalStorage()
      expect(migrated).not.toBeNull()
      expect(migrated!.activeTab).toBe("emails")

      // Should have list + detail + session panels for emails tab
      const emailPanels = migrated!.tabs.emails.panels
      expect(emailPanels.length).toBeGreaterThanOrEqual(2)
      expect(emailPanels[0].type).toBe("list")
      expect(emailPanels[1].type).toBe("detail")
    })

    it("returns null when no old state exists", async () => {
      const migrated = await migrateFromLocalStorage()
      expect(migrated).toBeNull()
    })

    it("removes old localStorage key after migration", async () => {
      localStorage.setItem("spatial-nav-state", JSON.stringify({
        pathname: "/emails",
        tabs: { emails: {}, tasks: {}, calendar: {}, sessions: {} },
        itemSessions: [],
      }))

      await migrateFromLocalStorage()
      expect(localStorage.getItem("spatial-nav-state")).toBeNull()
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/inbox && npx vitest run src/lib/__tests__/navigation-storage.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write implementation**

```typescript
// src/lib/navigation-storage.ts
import { get, set } from "idb-keyval"
import type { NavigationState, TabState } from "@/types/navigation"
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
  const validTypes = new Set(["list", "detail", "session", "artifact", "compose", "settings"])

  for (const [tabId, tabState] of Object.entries(state.tabs)) {
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/inbox && npx vitest run src/lib/__tests__/navigation-storage.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/navigation-storage.ts src/lib/__tests__/navigation-storage.test.ts
git commit -m "feat: add navigation storage (IndexedDB persistence + localStorage migration)"
```

---

## Chunk 2: NavigationProvider + useNavigation

### Task 4: NavigationProvider and useNavigation hook

**Files:**
- Create: `src/components/navigation/NavigationProvider.tsx`
- Create: `src/hooks/use-navigation.ts`
- Create: `src/hooks/__tests__/use-navigation.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// src/hooks/__tests__/use-navigation.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { NavigationProvider } from "@/components/navigation/NavigationProvider"
import { useNavigation } from "../use-navigation"
import type { NavigationState } from "@/types/navigation"

// Mock storage
vi.mock("@/lib/navigation-storage", () => ({
  saveNavigationState: vi.fn(() => Promise.resolve()),
  loadNavigationState: vi.fn(() => Promise.resolve(null)),
  migrateFromLocalStorage: vi.fn(() => Promise.resolve(null)),
}))

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <MemoryRouter initialEntries={["/emails"]}>
      <NavigationProvider>{children}</NavigationProvider>
    </MemoryRouter>
  )
}

describe("useNavigation", () => {
  it("provides default state", () => {
    const { result } = renderHook(() => useNavigation(), { wrapper })
    expect(result.current.activeTab).toBe("emails")
    expect(result.current.getPanels()).toEqual([{ id: "list", type: "list", props: {} }])
  })

  it("selectItem pushes a detail panel", () => {
    const { result } = renderHook(() => useNavigation(), { wrapper })
    act(() => result.current.selectItem("abc123"))
    const panels = result.current.getPanels()
    expect(panels).toHaveLength(2)
    expect(panels[1]).toEqual({ id: "detail:abc123", type: "detail", props: { itemId: "abc123" } })
    expect(result.current.getSelectedItemId()).toBe("abc123")
  })

  it("selectItem replaces existing detail panel and clears subsequent panels", () => {
    const { result } = renderHook(() => useNavigation(), { wrapper })
    act(() => result.current.selectItem("item1"))
    act(() => result.current.pushPanel({ id: "session:s1", type: "session", props: { sessionId: "s1" } }))
    expect(result.current.getPanels()).toHaveLength(3)

    act(() => result.current.selectItem("item2"))
    const panels = result.current.getPanels()
    expect(panels).toHaveLength(2) // list + new detail (session removed)
    expect(panels[1].props).toEqual({ itemId: "item2" })
  })

  it("deselectItem removes detail and subsequent panels", () => {
    const { result } = renderHook(() => useNavigation(), { wrapper })
    act(() => result.current.selectItem("abc"))
    act(() => result.current.deselectItem())
    expect(result.current.getPanels()).toHaveLength(1) // list only
    expect(result.current.getSelectedItemId()).toBeUndefined()
  })

  it("pushPanel adds to the end", () => {
    const { result } = renderHook(() => useNavigation(), { wrapper })
    act(() => result.current.selectItem("abc"))
    act(() => result.current.pushPanel({ id: "session:s1", type: "session", props: { sessionId: "s1" } }))
    expect(result.current.getPanels()).toHaveLength(3)
    expect(result.current.getPanels()[2].type).toBe("session")
  })

  it("popPanel removes by id", () => {
    const { result } = renderHook(() => useNavigation(), { wrapper })
    act(() => result.current.selectItem("abc"))
    act(() => result.current.pushPanel({ id: "session:s1", type: "session", props: { sessionId: "s1" } }))
    act(() => result.current.popPanel("session:s1"))
    expect(result.current.getPanels()).toHaveLength(2) // list + detail
  })

  it("openSession pushes a session panel", () => {
    const { result } = renderHook(() => useNavigation(), { wrapper })
    act(() => result.current.selectItem("abc"))
    act(() => result.current.openSession("sess123"))
    const panels = result.current.getPanels()
    expect(panels).toHaveLength(3)
    expect(panels[2]).toEqual({ id: "session:sess123", type: "session", props: { sessionId: "sess123" } })
  })

  it("openSession with undefined creates new session", () => {
    const { result } = renderHook(() => useNavigation(), { wrapper })
    act(() => result.current.selectItem("abc"))
    act(() => result.current.openSession())
    const panels = result.current.getPanels()
    expect(panels[2].props).toEqual({ sessionId: "new" })
  })

  it("switchTab changes activeTab", () => {
    const { result } = renderHook(() => useNavigation(), { wrapper })
    act(() => result.current.switchTab("tasks"))
    expect(result.current.activeTab).toBe("tasks")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/inbox && npx vitest run src/hooks/__tests__/use-navigation.test.tsx`
Expected: FAIL

- [ ] **Step 3: Create NavigationProvider**

```typescript
// src/components/navigation/NavigationProvider.tsx
import { createContext, useCallback, useEffect, useRef, useReducer, type ReactNode } from "react"
import { useNavigate, useLocation } from "react-router-dom"
import type { NavigationState, TabState, PanelState, TabId } from "@/types/navigation"
import { createDefaultNavigationState, createDefaultTabState } from "@/types/navigation"
import { saveNavigationState, loadNavigationState, migrateFromLocalStorage } from "@/lib/navigation-storage"

// --- Actions ---

type NavAction =
  | { type: "SET_STATE"; state: NavigationState }
  | { type: "SWITCH_TAB"; tabId: TabId }
  | { type: "SELECT_ITEM"; itemId: string; listIndex?: number }
  | { type: "DESELECT_ITEM" }
  | { type: "PUSH_PANEL"; panel: PanelState }
  | { type: "POP_PANEL"; panelId: string }
  | { type: "REPLACE_PANEL"; panelId: string; newPanel: PanelState }
  | { type: "OPEN_SESSION"; sessionId?: string }
  | { type: "SET_FILTER"; key: string; value: string }
  | { type: "CLEAR_FILTERS" }

function getOrCreateTab(state: NavigationState, tabId: TabId): TabState {
  return state.tabs[tabId] ?? createDefaultTabState()
}

function navReducer(state: NavigationState, action: NavAction): NavigationState {
  switch (action.type) {
    case "SET_STATE":
      return action.state

    case "SWITCH_TAB":
      return { ...state, activeTab: action.tabId }

    case "SELECT_ITEM": {
      const tab = { ...getOrCreateTab(state, state.activeTab) }
      tab.selectedItemId = action.itemId

      // If panels[1] is a detail panel, replace it and remove panels after
      if (tab.panels.length > 1 && tab.panels[1].type === "detail") {
        tab.panels = [
          tab.panels[0],
          { id: `detail:${action.itemId}`, type: "detail", props: { itemId: action.itemId } },
        ]
      } else {
        // Push detail at position 1
        tab.panels = [
          ...tab.panels.slice(0, 1),
          { id: `detail:${action.itemId}`, type: "detail", props: { itemId: action.itemId } },
        ]
      }

      return { ...state, tabs: { ...state.tabs, [state.activeTab]: tab } }
    }

    case "DESELECT_ITEM": {
      const tab = { ...getOrCreateTab(state, state.activeTab) }
      tab.selectedItemId = undefined
      tab.panels = tab.panels.slice(0, 1) // keep only list
      return { ...state, tabs: { ...state.tabs, [state.activeTab]: tab } }
    }

    case "PUSH_PANEL": {
      const tab = { ...getOrCreateTab(state, state.activeTab) }
      // Don't push duplicates
      if (tab.panels.some((p) => p.id === action.panel.id)) return state
      tab.panels = [...tab.panels, action.panel]
      return { ...state, tabs: { ...state.tabs, [state.activeTab]: tab } }
    }

    case "POP_PANEL": {
      const tab = { ...getOrCreateTab(state, state.activeTab) }
      tab.panels = tab.panels.filter((p) => p.id !== action.panelId)
      return { ...state, tabs: { ...state.tabs, [state.activeTab]: tab } }
    }

    case "REPLACE_PANEL": {
      const tab = { ...getOrCreateTab(state, state.activeTab) }
      tab.panels = tab.panels.map((p) => (p.id === action.panelId ? action.newPanel : p))
      return { ...state, tabs: { ...state.tabs, [state.activeTab]: tab } }
    }

    case "OPEN_SESSION": {
      const tab = { ...getOrCreateTab(state, state.activeTab) }
      const sessionId = action.sessionId ?? "new"
      const sessionPanel: PanelState = {
        id: `session:${sessionId}`,
        type: "session",
        props: { sessionId },
      }
      // Replace existing session panel or push
      const existingIdx = tab.panels.findIndex((p) => p.type === "session")
      if (existingIdx >= 0) {
        tab.panels = [...tab.panels]
        tab.panels[existingIdx] = sessionPanel
      } else {
        tab.panels = [...tab.panels, sessionPanel]
      }
      return { ...state, tabs: { ...state.tabs, [state.activeTab]: tab } }
    }

    case "SET_FILTER": {
      const tab = { ...getOrCreateTab(state, state.activeTab) }
      tab.activeFilters = { ...tab.activeFilters, [action.key]: action.value }
      return { ...state, tabs: { ...state.tabs, [state.activeTab]: tab } }
    }

    case "CLEAR_FILTERS": {
      const tab = { ...getOrCreateTab(state, state.activeTab) }
      tab.activeFilters = undefined
      return { ...state, tabs: { ...state.tabs, [state.activeTab]: tab } }
    }

    default:
      return state
  }
}

// --- Context ---

export interface NavigationContextValue {
  state: NavigationState
  dispatch: React.Dispatch<NavAction>
  itemDirectionRef: React.RefObject<number>
}

export const NavigationContext = createContext<NavigationContextValue | null>(null)

// --- Provider ---

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(navReducer, createDefaultNavigationState())
  const navigate = useNavigate()
  const location = useLocation()
  const initialized = useRef(false)
  const itemDirectionRef = useRef(1)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>()

  // Load state from storage on mount
  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    ;(async () => {
      let loaded = await loadNavigationState()
      if (!loaded) {
        loaded = await migrateFromLocalStorage()
      }
      if (loaded) {
        dispatch({ type: "SET_STATE", state: loaded })
        // Navigate to the restored state's active tab
        const tab = loaded.tabs[loaded.activeTab]
        const selectedId = tab?.selectedItemId
        const url = selectedId
          ? `/${loaded.activeTab}/${encodeURIComponent(selectedId)}`
          : `/${loaded.activeTab}`
        navigate(url, { replace: true })
      }
    })()
  }, [navigate])

  // Debounced persistence
  useEffect(() => {
    if (!initialized.current) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveNavigationState(state)
    }, 100)
    return () => clearTimeout(saveTimer.current)
  }, [state])

  // Sync URL on activeTab / selectedItemId changes
  useEffect(() => {
    if (!initialized.current) return
    const tab = state.tabs[state.activeTab]
    const selectedId = tab?.selectedItemId
    let targetUrl: string
    if (state.activeTab === "settings") {
      targetUrl = "/settings/integrations"
    } else if (state.activeTab.startsWith("plugin:")) {
      targetUrl = `/plugins/${state.activeTab.replace("plugin:", "")}`
    } else {
      targetUrl = selectedId
        ? `/${state.activeTab}/${encodeURIComponent(selectedId)}`
        : `/${state.activeTab}`
    }
    if (location.pathname !== targetUrl) {
      navigate(targetUrl, { replace: true })
    }
  }, [state.activeTab, state.tabs[state.activeTab]?.selectedItemId, navigate, location.pathname])

  return (
    <NavigationContext.Provider value={{ state, dispatch, itemDirectionRef }}>
      {children}
    </NavigationContext.Provider>
  )
}
```

- [ ] **Step 4: Create useNavigation hook**

```typescript
// src/hooks/use-navigation.ts
import { useContext, useCallback } from "react"
import { NavigationContext } from "@/components/navigation/NavigationProvider"
import type { PanelState, TabId } from "@/types/navigation"

export function useNavigation() {
  const ctx = useContext(NavigationContext)
  if (!ctx) throw new Error("useNavigation must be used within NavigationProvider")

  const { state, dispatch, itemDirectionRef } = ctx

  const switchTab = useCallback(
    (tabId: TabId) => dispatch({ type: "SWITCH_TAB", tabId }),
    [dispatch],
  )

  const selectItem = useCallback(
    (itemId: string, listIndex?: number) => {
      if (listIndex !== undefined) {
        itemDirectionRef.current = listIndex
      }
      dispatch({ type: "SELECT_ITEM", itemId, listIndex })
    },
    [dispatch, itemDirectionRef],
  )

  const deselectItem = useCallback(
    () => dispatch({ type: "DESELECT_ITEM" }),
    [dispatch],
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
```

- [ ] **Step 5: Run tests**

Run: `cd packages/inbox && npx vitest run src/hooks/__tests__/use-navigation.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/navigation/NavigationProvider.tsx src/hooks/use-navigation.ts src/hooks/__tests__/use-navigation.test.tsx
git commit -m "feat: add NavigationProvider + useNavigation hook with state management"
```

---

## Chunk 3: Panel + PanelSlot + Tab Components

### Task 5: Panel component

**Files:**
- Create: `src/components/navigation/Panel.tsx`

- [ ] **Step 1: Create Panel**

```tsx
// src/components/navigation/Panel.tsx
import type { PanelType } from "@/types/navigation"
import { DEFAULT_PANEL_WIDTH } from "@/lib/navigation-constants"

interface PanelProps {
  id: string
  variant?: PanelType
  width?: number
  children: React.ReactNode
}

export function Panel({ id, variant, width = DEFAULT_PANEL_WIDTH, children }: PanelProps) {
  return (
    <div
      data-panel-id={id}
      data-panel-variant={variant}
      className="shrink-0 h-full bg-card rounded-lg shadow-sm ring-1 ring-inset ring-border overflow-hidden"
      style={{ width }}
    >
      {children}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/navigation/Panel.tsx
git commit -m "feat: add Panel container component"
```

### Task 6: PanelSlot component

**Files:**
- Create: `src/components/navigation/PanelSlot.tsx`

- [ ] **Step 1: Create PanelSlot**

AnimatePresence wrapper that runs vertical slide animation when `panelId` changes at the same slot position (e.g., switching from EmailA detail to EmailB detail).

```tsx
// src/components/navigation/PanelSlot.tsx
import { useRef, useEffect, useState } from "react"
import { motion, AnimatePresence, usePresence } from "motion/react"
import { EASE, DURATION, ITEM_GAP } from "@/lib/navigation-constants"

interface PanelSlotProps {
  panelId: string
  directionRef: React.RefObject<number>
  children: React.ReactNode
}

const slotVariants = {
  enter: (direction: number) => ({
    y: direction > 0 ? `calc(100% + ${ITEM_GAP}px)` : `calc(-100% - ${ITEM_GAP}px)`,
    opacity: 0.5,
  }),
  center: { y: 0, opacity: 1 },
}

function computeExit(direction: number) {
  return {
    y: direction > 0 ? `calc(-100% - ${ITEM_GAP}px)` : `calc(100% + ${ITEM_GAP}px)`,
    opacity: 0.5,
  }
}

function AnimatedSlot({
  children,
  entryDirection,
  directionRef,
}: {
  children: React.ReactNode
  entryDirection: number
  directionRef: React.RefObject<number>
}) {
  const [isPresent, safeToRemove] = usePresence()
  const safeRef = useRef(safeToRemove)
  safeRef.current = safeToRemove

  const [target, setTarget] = useState(slotVariants.center)

  useEffect(() => {
    if (!isPresent) {
      setTarget(computeExit(directionRef.current))
      const timer = setTimeout(() => safeRef.current?.(), DURATION * 1000 + 50)
      return () => clearTimeout(timer)
    }
  }, [isPresent, directionRef])

  return (
    <motion.div
      initial={slotVariants.enter(entryDirection)}
      animate={target}
      transition={{ duration: DURATION, ease: EASE }}
      className="absolute inset-0"
    >
      {children}
    </motion.div>
  )
}

export function PanelSlot({ panelId, directionRef, children }: PanelSlotProps) {
  const prevIdRef = useRef(panelId)
  const entryDirectionRef = useRef(0)

  if (panelId !== prevIdRef.current) {
    entryDirectionRef.current = directionRef.current
    prevIdRef.current = panelId
  }

  return (
    <div className="relative h-full overflow-clip" style={{ contain: "strict" }}>
      <AnimatePresence initial={false}>
        <AnimatedSlot
          key={panelId}
          entryDirection={entryDirectionRef.current}
          directionRef={directionRef}
        >
          {children}
        </AnimatedSlot>
      </AnimatePresence>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/navigation/PanelSlot.tsx
git commit -m "feat: add PanelSlot AnimatePresence wrapper for item transitions"
```

### Task 7: Tab component

**Files:**
- Create: `src/components/navigation/Tab.tsx`

- [ ] **Step 1: Create Tab**

```tsx
// src/components/navigation/Tab.tsx
import { useRef, useEffect, useCallback } from "react"
import { useNavigation } from "@/hooks/use-navigation"
import type { TabId } from "@/types/navigation"

interface TabProps {
  id: TabId
  children: React.ReactNode
}

export function Tab({ id, children }: TabProps) {
  const { activeTab } = useNavigation()
  const scrollRef = useRef<HTMLDivElement>(null)
  const isActive = activeTab === id
  const prevPanelCountRef = useRef(0)
  const isFirstRender = useRef(true)

  // Save scroll position when deactivating
  // Restore scroll position when activating
  const savedScrollRef = useRef(0)
  useEffect(() => {
    if (isActive && scrollRef.current) {
      if (isFirstRender.current) {
        scrollRef.current.scrollLeft = savedScrollRef.current
        isFirstRender.current = false
      }
    }
    return () => {
      if (scrollRef.current) {
        savedScrollRef.current = scrollRef.current.scrollLeft
      }
    }
  }, [isActive])

  // Scroll new panels into view when panel count increases
  useEffect(() => {
    if (!isActive || !scrollRef.current) return
    const el = scrollRef.current
    const currentCount = el.children.length

    if (currentCount > prevPanelCountRef.current && !isFirstRender.current) {
      // Scroll to rightmost panel
      const lastChild = el.lastElementChild
      if (lastChild) {
        lastChild.scrollIntoView({ behavior: "smooth", inline: "end", block: "nearest" })
      }
    }
    prevPanelCountRef.current = currentCount
  })

  // Intercept horizontal wheel events on inner panels → redirect to outer scroll
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault()
        el.scrollLeft += e.deltaX
      }
    }
    el.addEventListener("wheel", handler, { passive: false })
    return () => el.removeEventListener("wheel", handler)
  }, [])

  if (!isActive) return null

  return (
    <div
      ref={scrollRef}
      className="flex flex-row h-full gap-4 shrink-0 overflow-y-hidden overflow-x-auto py-4 pr-4 pl-[var(--sidebar-width)]"
    >
      {children}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/navigation/Tab.tsx
git commit -m "feat: add Tab component with scroll management"
```

### Task 8: PanelContent placeholder

**Files:**
- Create: `src/components/navigation/PanelContent.tsx`

- [ ] **Step 1: Create PanelContent placeholder**

This maps `PanelState` → React component. It's a placeholder that will be filled in during tab migrations (Plan C). For now it renders the panel type as text.

```tsx
// src/components/navigation/PanelContent.tsx
import type { PanelState } from "@/types/navigation"

interface PanelContentProps {
  panel: PanelState
}

/**
 * Maps PanelState to the corresponding React component.
 * This is a placeholder — each panel type will be wired up
 * during the tab migration phase (Plan C).
 */
export function PanelContent({ panel }: PanelContentProps) {
  return (
    <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
      <div className="text-center">
        <p className="font-medium">{panel.type}</p>
        <p className="text-xs mt-1">{panel.id}</p>
        <pre className="text-xs mt-2 max-w-[300px] overflow-hidden">
          {JSON.stringify(panel.props, null, 2)}
        </pre>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/navigation/PanelContent.tsx
git commit -m "feat: add PanelContent placeholder (maps PanelState → component)"
```

### Task 9: Index barrel + run full test suite

**Files:**
- Create: `src/components/navigation/index.ts`

- [ ] **Step 1: Create barrel export**

```typescript
// src/components/navigation/index.ts
export { NavigationProvider } from "./NavigationProvider"
export { Tab } from "./Tab"
export { Panel } from "./Panel"
export { PanelSlot } from "./PanelSlot"
export { PanelContent } from "./PanelContent"
```

- [ ] **Step 2: Run full test suite**

Run: `cd packages/inbox && npm run test:ci`
Expected: PASS (all existing + new tests)

- [ ] **Step 3: Run e2e tests**

Run: `cd packages/inbox && npm run test:e2e`
Expected: PASS (no behavior change — new system not wired into app yet)

- [ ] **Step 4: Commit**

```bash
git add src/components/navigation/index.ts
git commit -m "feat: add navigation component barrel export"
```

---

## Verification

After completing all tasks:

1. **Unit tests pass:** `npm run test:ci` — new tests for navigation-storage and use-navigation
2. **E2e tests pass:** `npm run test:e2e` — no regressions (new system not yet wired in)
3. **No behavior change:** The app still uses PanelStack. The new navigation components exist alongside but are not rendered yet.
4. **Types compile:** `npx tsc --noEmit` passes

The new system is ready to be used by Plan B (ListView/DetailView) and Plan C (tab migrations).

---

## Summary

| Chunk | Tasks | Key Files |
|-------|-------|-----------|
| 1: Types + Storage | Tasks 1-3 | `types/navigation.ts`, `lib/navigation-constants.ts`, `lib/navigation-storage.ts` |
| 2: Provider + Hook | Task 4 | `components/navigation/NavigationProvider.tsx`, `hooks/use-navigation.ts` |
| 3: Components | Tasks 5-9 | `Panel.tsx`, `PanelSlot.tsx`, `Tab.tsx`, `PanelContent.tsx` |

**New dependencies:** None (idb-keyval already installed)
**Files created:** 10 (including tests)
**Files modified:** 1 (PanelStack.tsx — extract constants only)
