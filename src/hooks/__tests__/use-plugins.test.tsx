// @vitest-environment jsdom
import React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { usePlugins, usePluginItems, usePluginItemsInfinite } from "../use-plugins"
import * as client from "@/api/client"
import type { PluginManifest } from "@/api/client"

vi.mock("@/api/client")

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

const SAMPLE_PLUGINS: PluginManifest[] = [
  {
    id: "slack",
    name: "Slack",
    icon: "MessageSquare",
    fieldSchema: [
      { id: "channelType", label: "Type", type: "select" },
    ],
  },
]

describe("usePlugins", () => {
  let queryClient: QueryClient
  let wrapper: ReturnType<typeof makeWrapper>

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    wrapper = makeWrapper(queryClient)
    vi.resetAllMocks()
  })

  it("starts loading and resolves with plugin list", async () => {
    vi.mocked(client.getPlugins).mockResolvedValueOnce(SAMPLE_PLUGINS)

    const { result } = renderHook(() => usePlugins(), { wrapper })

    expect(result.current.isLoading).toBe(true)
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data).toHaveLength(1)
    expect(result.current.data![0].id).toBe("slack")
  })

  it("returns empty array when no plugins are loaded", async () => {
    vi.mocked(client.getPlugins).mockResolvedValueOnce([])

    const { result } = renderHook(() => usePlugins(), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data).toEqual([])
  })

  it("surfaces errors from the API", async () => {
    vi.mocked(client.getPlugins).mockRejectedValueOnce(new Error("Network error"))

    const { result } = renderHook(() => usePlugins(), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBeTruthy()
  })
})

describe("usePluginItems", () => {
  let queryClient: QueryClient
  let wrapper: ReturnType<typeof makeWrapper>

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    wrapper = makeWrapper(queryClient)
    vi.resetAllMocks()
  })

  it("fetches items for a source plugin", async () => {
    const items = [{ id: "C123", channelName: "general", channelType: "channel" }]
    vi.mocked(client.queryPluginItems).mockResolvedValueOnce({ items, nextCursor: undefined })

    const { result } = renderHook(() => usePluginItems("slack", {}), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data?.items).toHaveLength(1)
    expect(result.current.data?.items[0].id).toBe("C123")
  })

  it("passes filters to the API", async () => {
    vi.mocked(client.queryPluginItems).mockResolvedValueOnce({ items: [], nextCursor: undefined })

    const filters = { channelType: "dm", isUnread: "unread" }
    const { result } = renderHook(() => usePluginItems("slack", filters), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(vi.mocked(client.queryPluginItems)).toHaveBeenCalledWith("slack", filters, undefined)
  })

  it("is disabled when sourceId is empty string", async () => {
    const { result } = renderHook(() => usePluginItems("", {}), { wrapper })
    // Query should not fire — stays in initial state (not loading, no data)
    expect(result.current.isPending).toBe(true)
    expect(vi.mocked(client.queryPluginItems)).not.toHaveBeenCalled()
  })

  it("returns nextCursor when more pages are available", async () => {
    vi.mocked(client.queryPluginItems).mockResolvedValueOnce({
      items: [{ id: "x" }],
      nextCursor: "cursor-abc",
    })
    const { result } = renderHook(() => usePluginItems("slack", {}), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data?.nextCursor).toBe("cursor-abc")
  })
})

describe("usePluginItemsInfinite", () => {
  let queryClient: QueryClient
  let wrapper: ReturnType<typeof makeWrapper>

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    wrapper = makeWrapper(queryClient)
    vi.resetAllMocks()
  })

  it("Scenario: the list view paginates plugin items and preloads ahead of the viewport", async () => {
    vi.mocked(client.queryPluginItems)
      .mockResolvedValueOnce({ items: [{ id: "a" }, { id: "b" }], nextCursor: "c1" })
      .mockResolvedValueOnce({ items: [{ id: "c" }], nextCursor: undefined })

    const { result } = renderHook(() => usePluginItemsInfinite("gmail", {}), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    // Page 1: cursor undefined, more pages available.
    expect(vi.mocked(client.queryPluginItems)).toHaveBeenNthCalledWith(1, "gmail", {}, undefined)
    expect(result.current.hasNextPage).toBe(true)
    expect(result.current.data?.pages.flatMap((p) => p.items)).toHaveLength(2)

    // Page 2: fetched with the prior cursor; no more pages after.
    await result.current.fetchNextPage()
    await waitFor(() => expect(result.current.isFetchingNextPage).toBe(false))
    expect(vi.mocked(client.queryPluginItems)).toHaveBeenNthCalledWith(2, "gmail", {}, "c1")
    expect(result.current.data?.pages.flatMap((p) => p.items).map((i) => i.id)).toEqual(["a", "b", "c"])
    expect(result.current.hasNextPage).toBe(false)
  })

  it("is disabled when sourceId is empty", async () => {
    const { result } = renderHook(() => usePluginItemsInfinite("", {}), { wrapper })
    expect(result.current.isPending).toBe(true)
    expect(vi.mocked(client.queryPluginItems)).not.toHaveBeenCalled()
  })
})
