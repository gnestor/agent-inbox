// @vitest-environment jsdom
import React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useEmailThread } from "../hooks/use-email-thread"
import * as client from "../api"

vi.mock("../api")

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

  it("refetches when threadId changes back to a cached value (staleTime: 0)", async () => {
    const mockThread = { id: "t1", subject: "Hello", messages: [] } as any
    vi.mocked(client.getEmailThread).mockResolvedValue(mockThread)

    const { result, rerender } = renderHook(({ id }) => useEmailThread(id), {
      wrapper,
      initialProps: { id: "t1" as string | undefined },
    })
    await waitFor(() => expect(result.current.loading).toBe(false))

    rerender({ id: undefined })
    rerender({ id: "t1" })

    // staleTime: 0 means it refetches on remount to pick up new messages
    await waitFor(() => expect(client.getEmailThread).toHaveBeenCalledTimes(2))
    expect(result.current.thread).toEqual(mockThread)
  })
})
