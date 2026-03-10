// @vitest-environment jsdom
import React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor, act } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useEmails } from "../use-emails"
import * as client from "@/api/client"

vi.mock("@/api/client")

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe("useEmails", () => {
  let queryClient: QueryClient
  let wrapper: ReturnType<typeof makeWrapper>

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    wrapper = makeWrapper(queryClient)
    vi.resetAllMocks()
  })

  it("starts in loading state and resolves with messages", async () => {
    vi.mocked(client.searchEmails).mockResolvedValueOnce({
      messages: [{ id: "m1", threadId: "t1" } as any],
      nextPageToken: null,
    })

    const { result } = renderHook(() => useEmails(), { wrapper })

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.messages).toHaveLength(1)
    expect(result.current.messages[0].id).toBe("m1")
    expect(result.current.error).toBeNull()
  })

  it("sets hasMore=true when nextPageToken is returned", async () => {
    vi.mocked(client.searchEmails).mockResolvedValueOnce({
      messages: [{ id: "m1" } as any],
      nextPageToken: "tok123",
    })

    const { result } = renderHook(() => useEmails(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.hasMore).toBe(true)
  })

  it("sets hasMore=false when nextPageToken is null", async () => {
    vi.mocked(client.searchEmails).mockResolvedValueOnce({
      messages: [],
      nextPageToken: null,
    })

    const { result } = renderHook(() => useEmails(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.hasMore).toBe(false)
  })

  it("does not fetch when enabled=false", () => {
    const { result } = renderHook(() => useEmails(undefined, false), { wrapper })

    expect(result.current.loading).toBe(false)
    expect(client.searchEmails).not.toHaveBeenCalled()
    expect(result.current.messages).toEqual([])
  })

  it("exposes error message on API failure", async () => {
    vi.mocked(client.searchEmails).mockRejectedValueOnce(new Error("API 500: Server Error"))

    const { result } = renderHook(() => useEmails(), { wrapper })
    await waitFor(() => expect(result.current.error).toBe("API 500: Server Error"))
    expect(result.current.loading).toBe(false)
  })

  it("fetches next page on loadMore and appends messages", async () => {
    vi.mocked(client.searchEmails)
      .mockResolvedValueOnce({ messages: [{ id: "m1" } as any], nextPageToken: "tok1" })
      .mockResolvedValueOnce({ messages: [{ id: "m2" } as any], nextPageToken: null })

    const { result } = renderHook(() => useEmails(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.messages).toHaveLength(1)

    act(() => { result.current.loadMore() })
    await waitFor(() => expect(result.current.messages).toHaveLength(2))
    expect(result.current.messages[1].id).toBe("m2")
    expect(result.current.hasMore).toBe(false)
  })

  it("passes pageToken to searchEmails on loadMore", async () => {
    vi.mocked(client.searchEmails)
      .mockResolvedValueOnce({ messages: [{ id: "m1" } as any], nextPageToken: "tok-abc" })
      .mockResolvedValueOnce({ messages: [], nextPageToken: null })

    const { result } = renderHook(() => useEmails(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => { result.current.loadMore() })
    await waitFor(() => expect(result.current.loadingMore).toBe(false))

    expect(client.searchEmails).toHaveBeenCalledWith(expect.any(String), 50, "tok-abc")
  })
})
