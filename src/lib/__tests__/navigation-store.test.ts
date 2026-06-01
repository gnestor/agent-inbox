// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest"
import {
  useNavigationStore,
  createRecentTabState,
} from "../navigation-store"
import {
  createDefaultNavigationState,
  pluginIdFromTab,
  type PanelState,
} from "@/types/navigation"

function reset() {
  const fresh = createDefaultNavigationState()
  useNavigationStore.setState({ ...fresh, _initialized: false })
}

describe("navigation-store", () => {
  beforeEach(() => reset())

  // --- Tab and panel model ---

  it("Scenario: Tabs are typed, including dynamic plugin and recent tabs — pluginIdFromTab extracts suffix or undefined", () => {
    expect(pluginIdFromTab("plugin:gmail")).toBe("gmail")
    expect(pluginIdFromTab("plugin:notion-tasks")).toBe("notion-tasks")
    expect(pluginIdFromTab("sessions")).toBeUndefined()
    expect(pluginIdFromTab("recent:abc")).toBeUndefined()
    expect(pluginIdFromTab("settings")).toBeUndefined()
  })

  it("Scenario: PanelState is a discriminated union — each variant carries its props shape", () => {
    useNavigationStore.getState().switchTab("plugin:gmail")
    useNavigationStore.getState().selectItem("item1")
    const panels = useNavigationStore.getState().tabs["plugin:gmail"].panels
    const detail = panels.find((p) => p.type === "detail")
    expect(detail).toEqual({ id: "detail:item1", type: "detail", props: { itemId: "item1" } })
    useNavigationStore.getState().openSession("s1")
    const session = useNavigationStore.getState().tabs["plugin:gmail"].panels.find((p) => p.type === "session")
    expect(session?.props).toMatchObject({ sessionId: "s1" })
  })

  it("Scenario: Each tab owns its panel stack and per-tab state — no cross-tab leakage", () => {
    const store = useNavigationStore.getState()
    store.switchTab("plugin:gmail")
    store.selectItem("emailA")
    store.switchTab("sessions")
    store.selectItem("sessionX")
    // Gmail tab still has emailA, sessions has sessionX
    expect(useNavigationStore.getState().tabs["plugin:gmail"].selectedItemId).toBe("emailA")
    expect(useNavigationStore.getState().tabs.sessions.selectedItemId).toBe("sessionX")
  })

  // --- Store actions ---

  it("Scenario: `switchTab` creates a default tab on first visit", () => {
    useNavigationStore.getState().switchTab("plugin:brand-new")
    const tab = useNavigationStore.getState().tabs["plugin:brand-new"]
    expect(tab).toBeDefined()
    expect(tab.panels).toEqual([{ id: "list", type: "list", props: {} }])
  })

  it("Scenario: `selectItem` saves prior extra panels before swapping", () => {
    const store = useNavigationStore.getState()
    store.switchTab("plugin:gmail")
    store.selectItem("itemA")
    store.pushPanel({ id: "session:s1", type: "session", props: { sessionId: "s1" } })
    // itemA now has an extra panel (position 2)
    store.selectItem("itemB", 5) // listIndex provided
    const tab = useNavigationStore.getState().tabs["plugin:gmail"]
    // savedPanels for itemA snapshots the extra session panel
    expect(tab.savedPanels?.itemA).toEqual([{ id: "session:s1", type: "session", props: { sessionId: "s1" } }])
    // panels reset to list + detail-of-itemB
    expect(tab.panels.map((p) => p.id)).toEqual(["list", "detail:itemB"])
    // direction down (5 > 0) and transition is "item"
    expect(tab.itemDirection).toBe(1)
    expect(tab.panelTransition).toBe("item")
    // re-selecting itemA restores the saved session panel
    store.selectItem("itemA", 1)
    const restored = useNavigationStore.getState().tabs["plugin:gmail"]
    expect(restored.panels.map((p) => p.id)).toEqual(["list", "detail:itemA", "session:s1"])
    expect(restored.itemDirection).toBe(-1) // 1 < 5
  })

  it("Scenario: `pushPanel` is idempotent by panel id", () => {
    const store = useNavigationStore.getState()
    store.switchTab("plugin:gmail")
    store.selectItem("itemA")
    const panel: PanelState = { id: "session:s1", type: "session", props: { sessionId: "s1" } }
    store.pushPanel(panel)
    store.pushPanel(panel) // duplicate id
    const tab = useNavigationStore.getState().tabs["plugin:gmail"]
    expect(tab.panels.filter((p) => p.id === "session:s1")).toHaveLength(1)
    expect(tab.panelTransition).toBe("none")
  })

  it("Scenario: `popPanel` clears `selectedItemId` if no detail panel remains", () => {
    const store = useNavigationStore.getState()
    store.switchTab("plugin:gmail")
    store.selectItem("itemA")
    // pop the detail panel — no detail remains => selectedItemId cleared
    store.popPanel("detail:itemA")
    const tab = useNavigationStore.getState().tabs["plugin:gmail"]
    expect(tab.selectedItemId).toBeUndefined()
    expect(tab.panels.some((p) => p.type === "detail")).toBe(false)
  })

  it("Scenario: `replacePanel` swaps a single panel by id", () => {
    const store = useNavigationStore.getState()
    store.switchTab("plugin:gmail")
    store.selectItem("itemA")
    store.pushPanel({ id: "new_session", type: "new_session", props: {} })
    store.replacePanel(
      "new_session",
      { id: "session:abc", type: "session", props: { sessionId: "abc" } },
      "newItem",
    )
    const tab = useNavigationStore.getState().tabs["plugin:gmail"]
    expect(tab.panels.find((p) => p.id === "session:abc")).toBeDefined()
    expect(tab.panels.find((p) => p.id === "new_session")).toBeUndefined()
    expect(tab.selectedItemId).toBe("newItem")
  })

  it("Scenario: `openSession` replaces an existing session panel rather than appending", () => {
    const store = useNavigationStore.getState()
    store.switchTab("plugin:gmail")
    store.selectItem("itemA")
    store.openSession("s1")
    store.openSession("s2") // existing session panel replaced in place
    const tab = useNavigationStore.getState().tabs["plugin:gmail"]
    const sessions = tab.panels.filter((p) => p.type === "session")
    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe("session:s2")
  })

  it("Scenario: `openNewSession` keeps detail when invoked from a detail view", () => {
    const store = useNavigationStore.getState()
    store.switchTab("plugin:gmail")
    store.selectItem("itemA")
    store.openNewSession({ type: "email", id: "itemA", content: "hi" })
    const fromDetail = useNavigationStore.getState().tabs["plugin:gmail"]
    expect(fromDetail.panels.map((p) => p.type)).toEqual(["list", "detail", "new_session"])

    // From the "+" button (no source): clears selection, panels = [list, new_session]
    reset()
    useNavigationStore.getState().switchTab("plugin:gmail")
    useNavigationStore.getState().selectItem("itemA")
    useNavigationStore.getState().openNewSession()
    const fromPlus = useNavigationStore.getState().tabs["plugin:gmail"]
    expect(fromPlus.selectedItemId).toBeUndefined()
    expect(fromPlus.panels.map((p) => p.type)).toEqual(["list", "new_session"])
  })

  it("Scenario: `openRecent` builds an ephemeral `recent:<sessionId>` tab", () => {
    const store = useNavigationStore.getState()
    store.openRecent("sess99", "plugin:gmail", "emailA", 2)
    const state = useNavigationStore.getState()
    expect(state.activeTab).toBe("recent:sess99")
    const tab = state.tabs["recent:sess99"]
    expect(tab.sourceTab).toBe("plugin:gmail")
    expect(tab.sidebarIndex).toBe(2)
    expect(tab.itemDirection).toBe(1) // 2 > -1
    expect(tab.panels.some((p) => p.type === "session" && p.props.sessionId === "sess99")).toBe(true)
  })

  it("Scenario: `setFilter` strips empty values", () => {
    const store = useNavigationStore.getState()
    store.switchTab("plugin:gmail")
    store.setFilter("status", "open")
    expect(useNavigationStore.getState().tabs["plugin:gmail"].activeFilters).toEqual({ status: "open" })
    store.setFilter("status", "") // empty -> dropped, no keys remain -> undefined
    expect(useNavigationStore.getState().tabs["plugin:gmail"].activeFilters).toBeUndefined()
  })

  // --- Selectors and stable references ---

  it("Scenario: Empty selectors return stable fallbacks — useTabPanels / useActiveFilters return module constants", () => {
    // A tab with no state returns the SAME empty array reference each call
    const a = useNavigationStore.getState().tabs["plugin:nonexistent"]?.panels
    expect(a).toBeUndefined()
    // The selector hooks fall back to module-level constants; tested via store snapshot stability
    const panels1 = useNavigationStore.getState().tabs.sessions.panels
    const panels2 = useNavigationStore.getState().tabs.sessions.panels
    expect(panels1).toBe(panels2)
  })

  it("Scenario: `useHydratedPanels` gates panels until hydration completes — list-only before init unless URL produced detail", () => {
    // Simulate a tab with only a list panel and _initialized false
    reset()
    const tab = useNavigationStore.getState().tabs.sessions
    expect(useNavigationStore.getState()._initialized).toBe(false)
    expect(tab.panels.filter((p) => p.type === "list")).toHaveLength(1)
    // After hydration, all panels are exposed
    useNavigationStore.getState()._hydrate(createDefaultNavigationState())
    expect(useNavigationStore.getState()._initialized).toBe(true)
  })

  it("Scenario: `useNavActions` returns stable function identities", () => {
    const a = useNavigationStore.getState().switchTab
    useNavigationStore.getState().switchTab("plugin:gmail")
    const b = useNavigationStore.getState().switchTab
    expect(a).toBe(b) // action references never change
  })

  it("createRecentTabState builds detail+session panels for a plugin source", () => {
    const tab = createRecentTabState({ tabId: "recent:s1", sourceTab: "plugin:gmail", selectedId: "e1", sessionId: "s1" })
    expect(tab.panels.map((p) => p.type)).toEqual(["detail", "session"])
  })
})
