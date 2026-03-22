// @vitest-environment jsdom
import React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useEmailThread } from "../use-email-thread"
import * as client from "@/api/client"

vi.mock("@/api/client")

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe("useEmailThread", () => {
  let queryClient: QueryClient
  let wrapper: ReturnType<typeof makeWrapper>

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    wrapper = makeWrapper(queryClient)
    vi.resetAllMocks()
  })

  it("returns undefined thread and no loading when threadId is undefined", () => {
    const { result } = renderHook(() => useEmailThread(undefined), { wrapper })

    expect(result.current.thread).toBeUndefined()
    expect(result.current.loading).toBe(false)
    expect(client.getEmailThread).not.toHaveBeenCalled()
  })

  it("fetches and returns thread data", async () => {
    const mockThread = { id: "t1", subject: "Hello", messages: [] } as any
    vi.mocked(client.getEmailThread).mockResolvedValueOnce(mockThread)

    const { result } = renderHook(() => useEmailThread("t1"), { wrapper })

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.thread).toEqual(mockThread)
    expect(result.current.error).toBeNull()
    expect(client.getEmailThread).toHaveBeenCalledWith("t1")
  })

  it("exposes error message on API failure", async () => {
    vi.mocked(client.getEmailThread).mockRejectedValueOnce(new Error("API 404: Not Found"))

    const { result } = renderHook(() => useEmailThread("t1"), { wrapper })
    await waitFor(() => expect(result.current.error).toBe("API 404: Not Found"))
    expect(result.current.thread).toBeUndefined()
  })

  it("deduplicates requests for the same threadId", async () => {
    const mockThread = { id: "t1", subject: "Hello", messages: [] } as any
    vi.mocked(client.getEmailThread).mockResolvedValue(mockThread)

    renderHook(() => useEmailThread("t1"), { wrapper })
    renderHook(() => useEmailThread("t1"), { wrapper })

    await waitFor(() => expect(vi.mocked(client.getEmailThread).mock.calls.length).toBe(1))
  })

  it("does not refetch when threadId changes back to a cached value (staleTime: Infinity)", async () => {
    // Use production-equivalent config: staleTime Infinity + refetchOnMount false
    const stableQc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
    })
    const stableWrapper = makeWrapper(stableQc)
    const mockThread = { id: "t1", subject: "Hello", messages: [] } as any
    vi.mocked(client.getEmailThread).mockResolvedValue(mockThread)

    const { result, rerender } = renderHook(({ id }) => useEmailThread(id), {
      wrapper: stableWrapper,
      initialProps: { id: "t1" as string | undefined },
    })
    await waitFor(() => expect(result.current.loading).toBe(false))

    rerender({ id: undefined })
    rerender({ id: "t1" })

    // Should still be 1 call — data is in cache and staleTime is Infinity
    expect(client.getEmailThread).toHaveBeenCalledTimes(1)
    expect(result.current.thread).toEqual(mockThread)
  })
})
