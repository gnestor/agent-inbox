// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest"
import {
  saveNavigationState,
  loadNavigationState,
  migrateFromLocalStorage,
} from "../navigation-storage"
import { createDefaultNavigationState } from "@/types/navigation"

// Mock idb-keyval
const store = new Map<string, unknown>()
vi.mock("idb-keyval", () => ({
  get: vi.fn((key: string) => Promise.resolve(store.get(key))),
  set: vi.fn((key: string, value: unknown) => { store.set(key, value); return Promise.resolve() }),
  del: vi.fn((key: string) => { store.delete(key); return Promise.resolve() }),
}))

// Vitest's jsdom environment provides localStorage as a plain {} without Storage methods.
// Install a working in-memory localStorage mock.
const localStorageStore: Record<string, string> = {}
beforeAll(() => {
  Object.defineProperty(window, "localStorage", {
    value: {
      getItem: (k: string) => localStorageStore[k] ?? null,
      setItem: (k: string, v: string) => { localStorageStore[k] = v },
      removeItem: (k: string) => { delete localStorageStore[k] },
      clear: () => Object.keys(localStorageStore).forEach((k) => delete localStorageStore[k]),
    },
    writable: true,
    configurable: true,
  })
})

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
