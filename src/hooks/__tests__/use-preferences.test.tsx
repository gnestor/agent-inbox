// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"

// Mock API client before importing the hook
vi.mock("@/api/client", () => ({
  getPreferences: vi.fn(),
  setPreference: vi.fn().mockResolvedValue(undefined),
}))

// Reset module state between tests so the module-level cache/loadPromise start fresh
// The hook module caches state in variables that persist for the lifetime of the module,
// so we re-import it after each vi.resetModules() call.
import * as client from "@/api/client"

// Dynamically import after mocks are set up
let usePreference: typeof import("../use-preferences").usePreference

async function resetAndImport() {
  vi.resetModules()
  // Re-apply mock after reset (resetModules clears the registry)
  vi.mock("@/api/client", () => ({
    getPreferences: vi.fn(),
    setPreference: vi.fn().mockResolvedValue(undefined),
  }))
  const mod = await import("../use-preferences")
  usePreference = mod.usePreference
}

describe("usePreference", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await resetAndImport()
  })

  it("returns defaultValue before preferences load", () => {
    vi.mocked(client.getPreferences).mockResolvedValue({})
    const { result } = renderHook(() => usePreference("theme", "light"))
    // Before the async load resolves, returns the default
    expect(result.current[0]).toBe("light")
  })

  it("returns loaded value after preferences resolve", async () => {
    vi.mocked(client.getPreferences).mockResolvedValue({ theme: "dark" })
    const { result } = renderHook(() => usePreference("theme", "light"))
    await waitFor(() => expect(result.current[0]).toBe("dark"))
  })

  it("returns defaultValue when key is absent from loaded prefs", async () => {
    vi.mocked(client.getPreferences).mockResolvedValue({ other: "value" })
    const { result } = renderHook(() => usePreference("theme", "light"))
    await waitFor(() => expect(result.current[0]).toBe("light"))
  })

  it("setValue updates value immediately and calls setPreference", async () => {
    vi.mocked(client.getPreferences).mockResolvedValue({})
    const { result } = renderHook(() => usePreference("theme", "light"))
    await waitFor(() => expect(result.current[0]).toBe("light"))

    act(() => result.current[1]("dark"))

    expect(result.current[0]).toBe("dark")
    expect(client.setPreference).toHaveBeenCalledWith("theme", "dark")
  })

  it("notifies all hooks sharing the same key when one updates", async () => {
    vi.mocked(client.getPreferences).mockResolvedValue({})

    const { result: a } = renderHook(() => usePreference("theme", "light"))
    const { result: b } = renderHook(() => usePreference("theme", "light"))

    await waitFor(() => expect(a.current[0]).toBe("light"))

    act(() => a.current[1]("dark"))

    expect(a.current[0]).toBe("dark")
    expect(b.current[0]).toBe("dark")
  })

  it("does not notify hooks on a different key", async () => {
    vi.mocked(client.getPreferences).mockResolvedValue({})

    const { result: theme } = renderHook(() => usePreference("theme", "light"))
    const { result: lang } = renderHook(() => usePreference("language", "en"))

    await waitFor(() => expect(theme.current[0]).toBe("light"))

    act(() => theme.current[1]("dark"))

    expect(lang.current[0]).toBe("en")
  })

  it("works with object values", async () => {
    const defaultVis = { messages: true, toolCalls: true, thinking: true }
    vi.mocked(client.getPreferences).mockResolvedValue({
      visibility: { messages: false, toolCalls: true, thinking: false },
    })

    const { result } = renderHook(() => usePreference("visibility", defaultVis))
    await waitFor(() => expect(result.current[0]).toEqual({ messages: false, toolCalls: true, thinking: false }))

    act(() => result.current[1]({ messages: true, toolCalls: false, thinking: true }))
    expect(result.current[0]).toEqual({ messages: true, toolCalls: false, thinking: true })
  })
})
