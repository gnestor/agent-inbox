// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  saveNavigationState,
  loadNavigationState,
  cleanFilters,
} from "../navigation-storage"
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
  })

  describe("saveNavigationState / loadNavigationState", () => {
    it("round-trips a navigation state", async () => {
      const state = createDefaultNavigationState()
      state.activeTab = "plugin:gmail"
      await saveNavigationState(state)
      const loaded = await loadNavigationState()
      expect(loaded).toEqual(state)
    })

    it("returns null when no state saved", async () => {
      const loaded = await loadNavigationState()
      expect(loaded).toBeNull()
    })

    it("Scenario: Version mismatch drops persisted state — old version returns null and deletes blob", async () => {
      // Seed an old version with some state
      store.set("INBOX_NAV_STATE", { activeTab: "sessions", tabs: { sessions: { panels: [], panelScrollOffset: 0 } } })
      store.set("INBOX_NAV_STATE_VERSION", 2) // < CURRENT_VERSION (3)
      const loaded = await loadNavigationState()
      expect(loaded).toBeNull()
      expect(store.has("INBOX_NAV_STATE")).toBe(false) // blob deleted
      expect(store.get("INBOX_NAV_STATE_VERSION")).toBe(3) // bumped
    })

    it("Scenario: Unknown panel types are stripped on load — invalid + new_session panels removed", async () => {
      store.set("INBOX_NAV_STATE_VERSION", 3)
      store.set("INBOX_NAV_STATE", {
        activeTab: "plugin:gmail",
        tabs: {
          sessions: { panelScrollOffset: 0, panels: [{ id: "list", type: "list", props: {} }] },
          "plugin:gmail": {
            panelScrollOffset: 0,
            panels: [
              { id: "list", type: "list", props: {} },
              { id: "bogus", type: "totally-unknown", props: {} },
              { id: "new_session", type: "new_session", props: {} },
            ],
            savedPanels: {
              e1: [{ id: "junk", type: "deleted-type", props: {} }],
            },
          },
        },
      })
      const loaded = await loadNavigationState()
      const gmail = loaded!.tabs["plugin:gmail"]
      // unknown + new_session stripped from panels
      expect(gmail.panels.map((p) => p.type)).toEqual(["list"])
      // savedPanels entry with only invalid panels dropped entirely
      expect(gmail.savedPanels).toBeUndefined()
    })

    it("Scenario: `sessions` tab always exists — recreated and list panel ensured at position 0", async () => {
      store.set("INBOX_NAV_STATE_VERSION", 3)
      store.set("INBOX_NAV_STATE", {
        activeTab: "plugin:gmail",
        tabs: {
          // sessions missing entirely
          "plugin:gmail": {
            panelScrollOffset: 0,
            panels: [{ id: "detail:x", type: "detail", props: { itemId: "x" } }], // no list at 0
          },
        },
      })
      const loaded = await loadNavigationState()
      expect(loaded!.tabs.sessions).toBeDefined()
      // plugin tab gets a list panel ensured at position 0
      expect(loaded!.tabs["plugin:gmail"].panels[0].type).toBe("list")
    })
  })

  describe("cleanFilters", () => {
    it("Scenario: `setFilter` strips empty values — cleanFilters drops empty keys, returns undefined when none remain", () => {
      expect(cleanFilters({ a: "x", b: "" })).toEqual({ a: "x" })
      expect(cleanFilters({ a: "" })).toBeUndefined()
      expect(cleanFilters(undefined)).toBeUndefined()
    })
  })
})
