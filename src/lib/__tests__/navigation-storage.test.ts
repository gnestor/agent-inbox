// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  saveNavigationState,
  loadNavigationState,
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
  })
})
