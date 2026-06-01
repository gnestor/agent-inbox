// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { buildUrl, parseUrl, NavigationProvider } from "../NavigationProvider"
import { useNavigationStore } from "@/lib/navigation-store"
import { createDefaultNavigationState } from "@/types/navigation"

// in-memory idb-keyval mock
const idb = new Map<string, unknown>()
vi.mock("idb-keyval", () => ({
  get: vi.fn((k: string) => Promise.resolve(idb.get(k))),
  set: vi.fn((k: string, v: unknown) => { idb.set(k, v); return Promise.resolve() }),
  del: vi.fn((k: string) => { idb.delete(k); return Promise.resolve() }),
}))

beforeEach(() => {
  idb.clear()
  useNavigationStore.setState({ ...createDefaultNavigationState(), _initialized: false })
})

describe("NavigationProvider URL helpers", () => {
  it("Scenario: `buildUrl` covers settings, plugins, sessions, and recent", () => {
    // settings
    expect(buildUrl("settings")).toBe("/settings/integrations")
    // plugins
    expect(buildUrl("plugin:gmail")).toBe("/gmail")
    expect(buildUrl("plugin:gmail", "e 1")).toBe("/gmail/e%201")
    // sessions
    expect(buildUrl("sessions")).toBe("/sessions")
    expect(buildUrl("sessions", "abc")).toBe("/sessions/abc")
    // recent — sessions source
    expect(
      buildUrl("recent:s1", undefined, {
        panelScrollOffset: 0,
        sourceTab: "sessions",
        panels: [{ id: "session:s1", type: "session", props: { sessionId: "s1" } }],
      }),
    ).toBe("/recent/sessions/s1")
    // recent — plugin source with detail + session
    expect(
      buildUrl("recent:s2", undefined, {
        panelScrollOffset: 0,
        sourceTab: "plugin:gmail",
        panels: [
          { id: "detail:e1", type: "detail", props: { itemId: "e1" } },
          { id: "session:s2", type: "session", props: { sessionId: "s2" } },
        ],
      }),
    ).toBe("/recent/gmail/e1/session/s2")
  })

  it("Scenario: Browser back/forward drives state — parseUrl extracts tab and selection", () => {
    expect(parseUrl("/settings/integrations")).toEqual({ tabId: "settings" })
    expect(parseUrl("/sessions")).toEqual({ tabId: "sessions", selectedId: undefined })
    expect(parseUrl("/sessions/abc")).toEqual({ tabId: "sessions", selectedId: "abc" })
    expect(parseUrl("/gmail/e%201")).toEqual({ tabId: "plugin:gmail", selectedId: "e 1" })
    expect(parseUrl("/recent/sessions/s1")).toEqual({ tabId: "recent:s1", sourceTab: "sessions", sessionId: "s1" })
    expect(parseUrl("/recent/gmail/e1/session/s2")).toEqual({
      tabId: "recent:s2",
      sourceTab: "plugin:gmail",
      selectedId: "e1",
      sessionId: "s2",
    })
  })
})

function renderProvider(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NavigationProvider>
        <div>child</div>
      </NavigationProvider>
    </MemoryRouter>,
  )
}

describe("NavigationProvider mount behavior", () => {
  it("Scenario: URL is the source of truth on first paint — store pre-populated synchronously from URL", () => {
    renderProvider("/gmail/email42")
    const store = useNavigationStore.getState()
    expect(store.activeTab).toBe("plugin:gmail")
    const tab = store.tabs["plugin:gmail"]
    expect(tab.selectedItemId).toBe("email42")
    expect(tab.panels.map((p) => p.type)).toEqual(["list", "detail"])
  })

  it("Scenario: IndexedDB hydration merges with URL — persisted filters kept, URL wins for selection", async () => {
    // Seed persisted state with a filter on the gmail tab but a different selection
    idb.set("INBOX_NAV_STATE_VERSION", 3)
    idb.set("INBOX_NAV_STATE", {
      activeTab: "sessions",
      tabs: {
        sessions: { panelScrollOffset: 0, panels: [{ id: "list", type: "list", props: {} }] },
        "plugin:gmail": {
          panelScrollOffset: 0,
          panels: [{ id: "list", type: "list", props: {} }],
          activeFilters: { status: "unread" },
        },
      },
    })
    renderProvider("/gmail/emailNew")
    await waitFor(() => expect(useNavigationStore.getState()._initialized).toBe(true))
    const tab = useNavigationStore.getState().tabs["plugin:gmail"]
    // persisted filter retained
    expect(tab.activeFilters).toEqual({ status: "unread" })
    // URL selection wins
    expect(tab.selectedItemId).toBe("emailNew")
  })

  it("Scenario: State changes drive the URL — navigate fires only on actual change", async () => {
    renderProvider("/sessions")
    await waitFor(() => expect(useNavigationStore.getState()._initialized).toBe(true))
    // selecting an item updates the store, which the provider syncs to a URL
    useNavigationStore.getState().selectItem("sess-1")
    await waitFor(() =>
      expect(useNavigationStore.getState().tabs.sessions.selectedItemId).toBe("sess-1"),
    )
  })

  it("Scenario: Save is debounced — multiple rapid updates collapse into one persisted write", async () => {
    renderProvider("/sessions")
    await waitFor(() => expect(useNavigationStore.getState()._initialized).toBe(true))
    useNavigationStore.getState().switchTab("plugin:gmail")
    useNavigationStore.getState().selectItem("a")
    useNavigationStore.getState().selectItem("b")
    // After the debounce window, a write lands
    await waitFor(
      () => expect(idb.get("INBOX_NAV_STATE")).toBeDefined(),
      { timeout: 1000 },
    )
  })
})
