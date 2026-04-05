// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"

// ---------------------------------------------------------------------------
// Mock idb-keyval
// ---------------------------------------------------------------------------

const store = new Map<string, string>()

vi.mock("idb-keyval", () => ({
  get: vi.fn(async (key: string) => store.get(key)),
  set: vi.fn(async (key: string, value: string) => { store.set(key, value) }),
  del: vi.fn(async (key: string) => { store.delete(key) }),
}))

import { get, set, del } from "idb-keyval"
import { useLocalDraft } from "../use-local-draft"

describe("useLocalDraft", () => {
  beforeEach(() => {
    store.clear()
    vi.clearAllMocks()
  })

  it("returns empty string as initial value", () => {
    const { result } = renderHook(() => useLocalDraft("session-1"))
    expect(result.current[0]).toBe("")
  })

  it("loads persisted value from IndexedDB on mount", async () => {
    store.set("draft:session-1", "saved text")

    const { result } = renderHook(() => useLocalDraft("session-1"))

    await waitFor(() => expect(result.current[0]).toBe("saved text"))
    expect(get).toHaveBeenCalledWith("draft:session-1")
  })

  it("persists value to IndexedDB when setDraft is called", async () => {
    const { result } = renderHook(() => useLocalDraft("session-1"))

    act(() => {
      result.current[1]("hello world")
    })

    expect(result.current[0]).toBe("hello world")
    expect(set).toHaveBeenCalledWith("draft:session-1", "hello world")
  })

  it("deletes from IndexedDB when value is empty or whitespace", () => {
    const { result } = renderHook(() => useLocalDraft("session-1"))

    act(() => {
      result.current[1]("some text")
    })
    expect(set).toHaveBeenCalled()

    vi.clearAllMocks()

    act(() => {
      result.current[1]("")
    })
    expect(del).toHaveBeenCalledWith("draft:session-1")
    expect(set).not.toHaveBeenCalled()
  })

  it("deletes from IndexedDB when value is only whitespace", () => {
    const { result } = renderHook(() => useLocalDraft("session-1"))

    act(() => {
      result.current[1]("   ")
    })
    expect(del).toHaveBeenCalledWith("draft:session-1")
  })

  it("resets draft when key changes", async () => {
    store.set("draft:session-2", "draft for session 2")

    const { result, rerender } = renderHook(
      ({ key }) => useLocalDraft(key),
      { initialProps: { key: "session-1" } },
    )

    expect(result.current[0]).toBe("")

    rerender({ key: "session-2" })

    await waitFor(() => expect(result.current[0]).toBe("draft for session 2"))
  })
})
