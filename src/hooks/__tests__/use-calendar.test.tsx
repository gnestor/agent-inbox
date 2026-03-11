// @vitest-environment jsdom
import React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor, act } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useCalendar } from "../use-calendar"
import * as client from "@/api/client"

vi.mock("@/api/client")

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe("useCalendar", () => {
  let queryClient: QueryClient
  let wrapper: ReturnType<typeof makeWrapper>

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    wrapper = makeWrapper(queryClient)
    vi.resetAllMocks()
  })

  it("starts in loading state and resolves with items", async () => {
    vi.mocked(client.getCalendarItems).mockResolvedValueOnce({
      items: [{ id: "cal1", title: "Team sync" } as any],
      nextCursor: null,
    })

    const { result } = renderHook(() => useCalendar(), { wrapper })

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.items).toHaveLength(1)
    expect(result.current.items[0].id).toBe("cal1")
    expect(result.current.error).toBeNull()
  })

  it("sets hasMore=true when nextCursor is returned", async () => {
    vi.mocked(client.getCalendarItems).mockResolvedValueOnce({
      items: [{ id: "cal1" } as any],
      nextCursor: "cursor123",
    })

    const { result } = renderHook(() => useCalendar(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.hasMore).toBe(true)
  })

  it("does not fetch when enabled=false", () => {
    const { result } = renderHook(() => useCalendar(undefined, false), { wrapper })

    expect(result.current.loading).toBe(false)
    expect(client.getCalendarItems).not.toHaveBeenCalled()
    expect(result.current.items).toEqual([])
  })

  it("passes filters to getCalendarItems", async () => {
    vi.mocked(client.getCalendarItems).mockResolvedValueOnce({ items: [], nextCursor: null })

    const filters = { status: "In Progress", assignee: "Alice" }
    const { result } = renderHook(() => useCalendar(filters), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(client.getCalendarItems).toHaveBeenCalledWith(
      expect.objectContaining({ status: "In Progress", assignee: "Alice" }),
    )
  })

  it("exposes error message on API failure", async () => {
    vi.mocked(client.getCalendarItems).mockRejectedValueOnce(new Error("API 401: Unauthorized"))

    const { result } = renderHook(() => useCalendar(), { wrapper })
    await waitFor(() => expect(result.current.error).toBe("API 401: Unauthorized"))
  })

  it("fetches next page on loadMore and appends items", async () => {
    vi.mocked(client.getCalendarItems)
      .mockResolvedValueOnce({ items: [{ id: "c1" } as any], nextCursor: "c1" })
      .mockResolvedValueOnce({ items: [{ id: "c2" } as any], nextCursor: null })

    const { result } = renderHook(() => useCalendar(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.items).toHaveLength(1)

    act(() => {
      result.current.loadMore()
    })
    await waitFor(() => expect(result.current.items).toHaveLength(2))
    expect(result.current.items[1].id).toBe("c2")
    expect(result.current.hasMore).toBe(false)
  })

  it("passes cursor to getCalendarItems on loadMore", async () => {
    vi.mocked(client.getCalendarItems)
      .mockResolvedValueOnce({ items: [{ id: "c1" } as any], nextCursor: "cursor-xyz" })
      .mockResolvedValueOnce({ items: [], nextCursor: null })

    const { result } = renderHook(() => useCalendar(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => {
      result.current.loadMore()
    })
    await waitFor(() => expect(result.current.loadingMore).toBe(false))

    expect(client.getCalendarItems).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: "cursor-xyz" }),
    )
  })
})
