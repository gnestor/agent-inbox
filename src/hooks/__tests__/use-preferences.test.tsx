// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

vi.mock("@/api/client", () => ({
  getPreferences: vi.fn(),
  setPreference: vi.fn().mockResolvedValue(undefined),
}))

import * as client from "@/api/client"
import { usePreference } from "../use-preferences"

let queryClient: QueryClient

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe("usePreference", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
  })

  it("returns defaultValue before preferences load", () => {
    vi.mocked(client.getPreferences).mockResolvedValue({})
    const { result } = renderHook(() => usePreference("theme", "light"), { wrapper })
    expect(result.current[0]).toBe("light")
  })

  it("returns loaded value after preferences resolve", async () => {
    vi.mocked(client.getPreferences).mockResolvedValue({ theme: "dark" })
    const { result } = renderHook(() => usePreference("theme", "light"), { wrapper })
    await waitFor(() => expect(result.current[0]).toBe("dark"))
  })

  it("returns defaultValue when key is absent from loaded prefs", async () => {
    vi.mocked(client.getPreferences).mockResolvedValue({ other: "value" })
    const { result } = renderHook(() => usePreference("theme", "light"), { wrapper })
    await waitFor(() => expect(result.current[0]).toBe("light"))
  })

  it("setValue updates value immediately and calls setPreference", async () => {
    vi.mocked(client.getPreferences).mockResolvedValue({})
    const { result } = renderHook(() => usePreference("theme", "light"), { wrapper })
    await waitFor(() => expect(result.current[0]).toBe("light"))

    act(() => result.current[1]("dark"))

    await waitFor(() => expect(result.current[0]).toBe("dark"))
    expect(client.setPreference).toHaveBeenCalledWith("theme", "dark")
  })

  it("notifies all hooks sharing the same key when one updates", async () => {
    vi.mocked(client.getPreferences).mockResolvedValue({})

    // Both hooks must share the same QueryClient to observe cache updates
    const { result } = renderHook(
      () => ({
        a: usePreference("theme", "light"),
        b: usePreference("theme", "light"),
      }),
      { wrapper },
    )

    await waitFor(() => expect(result.current.a[0]).toBe("light"))

    act(() => result.current.a[1]("dark"))

    await waitFor(() => {
      expect(result.current.a[0]).toBe("dark")
      expect(result.current.b[0]).toBe("dark")
    })
  })

  it("does not notify hooks on a different key", async () => {
    vi.mocked(client.getPreferences).mockResolvedValue({})

    const { result } = renderHook(
      () => ({
        theme: usePreference("theme", "light"),
        lang: usePreference("language", "en"),
      }),
      { wrapper },
    )

    await waitFor(() => expect(result.current.theme[0]).toBe("light"))

    act(() => result.current.theme[1]("dark"))

    await waitFor(() => expect(result.current.theme[0]).toBe("dark"))
    expect(result.current.lang[0]).toBe("en")
  })

  it("works with object values", async () => {
    const defaultVis = { messages: true, toolCalls: true, thinking: true }
    vi.mocked(client.getPreferences).mockResolvedValue({
      visibility: { messages: false, toolCalls: true, thinking: false },
    })

    const { result } = renderHook(() => usePreference("visibility", defaultVis), { wrapper })
    await waitFor(() => expect(result.current[0]).toEqual({ messages: false, toolCalls: true, thinking: false }))

    act(() => result.current[1]({ messages: true, toolCalls: false, thinking: true }))
    await waitFor(() => expect(result.current[0]).toEqual({ messages: true, toolCalls: false, thinking: true }))
  })
})
