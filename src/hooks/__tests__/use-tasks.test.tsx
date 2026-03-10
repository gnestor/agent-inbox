// @vitest-environment jsdom
import React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor, act } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useTasks } from "../use-tasks"
import * as client from "@/api/client"

vi.mock("@/api/client")

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe("useTasks", () => {
  let queryClient: QueryClient
  let wrapper: ReturnType<typeof makeWrapper>

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    wrapper = makeWrapper(queryClient)
    vi.resetAllMocks()
  })

  it("starts in loading state and resolves with tasks", async () => {
    vi.mocked(client.getTasks).mockResolvedValueOnce({
      tasks: [{ id: "task1", title: "Fix bug" } as any],
      nextCursor: null,
    })

    const { result } = renderHook(() => useTasks(), { wrapper })

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.tasks).toHaveLength(1)
    expect(result.current.tasks[0].id).toBe("task1")
    expect(result.current.error).toBeNull()
  })

  it("sets hasMore=true when nextCursor is returned", async () => {
    vi.mocked(client.getTasks).mockResolvedValueOnce({
      tasks: [{ id: "task1" } as any],
      nextCursor: "cursor123",
    })

    const { result } = renderHook(() => useTasks(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.hasMore).toBe(true)
  })

  it("does not fetch when enabled=false", () => {
    const { result } = renderHook(() => useTasks(undefined, false), { wrapper })

    expect(result.current.loading).toBe(false)
    expect(client.getTasks).not.toHaveBeenCalled()
    expect(result.current.tasks).toEqual([])
  })

  it("passes filters to getTasks", async () => {
    vi.mocked(client.getTasks).mockResolvedValueOnce({ tasks: [], nextCursor: null })

    const filters = { status: "In Progress", assignee: "Alice" }
    const { result } = renderHook(() => useTasks(filters), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(client.getTasks).toHaveBeenCalledWith(expect.objectContaining({ status: "In Progress", assignee: "Alice" }))
  })

  it("exposes error message on API failure", async () => {
    vi.mocked(client.getTasks).mockRejectedValueOnce(new Error("API 401: Unauthorized"))

    const { result } = renderHook(() => useTasks(), { wrapper })
    await waitFor(() => expect(result.current.error).toBe("API 401: Unauthorized"))
  })

  it("fetches next page on loadMore and appends tasks", async () => {
    vi.mocked(client.getTasks)
      .mockResolvedValueOnce({ tasks: [{ id: "t1" } as any], nextCursor: "c1" })
      .mockResolvedValueOnce({ tasks: [{ id: "t2" } as any], nextCursor: null })

    const { result } = renderHook(() => useTasks(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.tasks).toHaveLength(1)

    act(() => { result.current.loadMore() })
    await waitFor(() => expect(result.current.tasks).toHaveLength(2))
    expect(result.current.tasks[1].id).toBe("t2")
    expect(result.current.hasMore).toBe(false)
  })

  it("passes cursor to getTasks on loadMore", async () => {
    vi.mocked(client.getTasks)
      .mockResolvedValueOnce({ tasks: [{ id: "t1" } as any], nextCursor: "cursor-xyz" })
      .mockResolvedValueOnce({ tasks: [], nextCursor: null })

    const { result } = renderHook(() => useTasks(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => { result.current.loadMore() })
    await waitFor(() => expect(result.current.loadingMore).toBe(false))

    expect(client.getTasks).toHaveBeenCalledWith(expect.objectContaining({ cursor: "cursor-xyz" }))
  })
})
