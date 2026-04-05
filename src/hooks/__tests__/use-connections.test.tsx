// @vitest-environment jsdom
import React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor, act } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useConnections, useDisconnectIntegration } from "../use-connections"
import * as client from "@/api/client"
import type { Integration } from "@/types"

vi.mock("@/api/client")
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

const fakeIntegrations: Integration[] = [
  { id: "gmail", name: "Gmail", icon: "mail", scope: "user", authType: "oauth2", connected: true },
  { id: "notion", name: "Notion", icon: "book", scope: "workspace", authType: "api_key", connected: true },
]

describe("useConnections", () => {
  let queryClient: QueryClient
  let wrapper: ReturnType<typeof makeWrapper>

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    wrapper = makeWrapper(queryClient)
    vi.resetAllMocks()
  })

  it("fetches connections and selects integrations array", async () => {
    vi.mocked(client.getConnections).mockResolvedValueOnce({ integrations: fakeIntegrations })

    const { result } = renderHook(() => useConnections(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(fakeIntegrations)
    expect(result.current.data).toHaveLength(2)
  })

  it("returns undefined data while loading", () => {
    vi.mocked(client.getConnections).mockReturnValue(new Promise(() => {}))

    const { result } = renderHook(() => useConnections(), { wrapper })

    expect(result.current.isLoading).toBe(true)
    expect(result.current.data).toBeUndefined()
  })

  it("exposes error on fetch failure", async () => {
    vi.mocked(client.getConnections).mockRejectedValueOnce(new Error("Network error"))

    const { result } = renderHook(() => useConnections(), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBeInstanceOf(Error)
  })
})

describe("useDisconnectIntegration", () => {
  let queryClient: QueryClient
  let wrapper: ReturnType<typeof makeWrapper>

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    wrapper = makeWrapper(queryClient)
    vi.resetAllMocks()
  })

  it("calls disconnectIntegration API on mutate", async () => {
    vi.mocked(client.disconnectIntegration).mockResolvedValueOnce({ ok: true })
    // Seed the cache so optimistic update works
    queryClient.setQueryData(["connections"], { integrations: fakeIntegrations })

    const { result } = renderHook(() => useDisconnectIntegration(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync("gmail")
    })

    expect(client.disconnectIntegration).toHaveBeenCalledWith("gmail")
  })

  it("optimistically sets connected=false on the target integration", async () => {
    vi.mocked(client.disconnectIntegration).mockResolvedValueOnce({ ok: true })
    vi.mocked(client.getConnections).mockResolvedValue({ integrations: fakeIntegrations })
    queryClient.setQueryData(["connections"], { integrations: fakeIntegrations })

    const { result } = renderHook(() => useDisconnectIntegration(), { wrapper })

    act(() => {
      result.current.mutate("gmail")
    })

    // After optimistic update, the cached data should show gmail as disconnected
    await waitFor(() => {
      const cached = queryClient.getQueryData<{ integrations: Integration[] }>(["connections"])
      expect(cached?.integrations.find((i) => i.id === "gmail")?.connected).toBe(false)
    })
  })

  it("rolls back on error", async () => {
    vi.mocked(client.disconnectIntegration).mockRejectedValueOnce(new Error("Server error"))
    vi.mocked(client.getConnections).mockResolvedValue({ integrations: fakeIntegrations })
    queryClient.setQueryData(["connections"], { integrations: fakeIntegrations })

    const { result } = renderHook(() => useDisconnectIntegration(), { wrapper })

    await act(async () => {
      try {
        await result.current.mutateAsync("gmail")
      } catch {}
    })

    // Should have rolled back — gmail still connected
    const cached = queryClient.getQueryData<{ integrations: Integration[] }>(["connections"])
    expect(cached?.integrations.find((i) => i.id === "gmail")?.connected).toBe(true)
  })
})
