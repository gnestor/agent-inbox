// @vitest-environment jsdom
import React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useSessions } from "../use-sessions"
import * as client from "@/api/client"

vi.mock("@/api/client")

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe("useSessions", () => {
  let queryClient: QueryClient
  let wrapper: ReturnType<typeof makeWrapper>

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    wrapper = makeWrapper(queryClient)
    vi.resetAllMocks()
  })

  it("starts in loading state and resolves with sessions", async () => {
    vi.mocked(client.getSessions).mockResolvedValueOnce({
      sessions: [{ id: "s1", status: "complete", prompt: "Do the thing" } as any],
    })

    const { result } = renderHook(() => useSessions(), { wrapper })

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.sessions).toHaveLength(1)
    expect(result.current.sessions[0].id).toBe("s1")
    expect(result.current.error).toBeNull()
  })

  it("returns empty array when no sessions", async () => {
    vi.mocked(client.getSessions).mockResolvedValueOnce({ sessions: [] })

    const { result } = renderHook(() => useSessions(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.sessions).toEqual([])
  })

  it("does not fetch when enabled=false", () => {
    const { result } = renderHook(() => useSessions(undefined, false), { wrapper })

    expect(result.current.loading).toBe(false)
    expect(client.getSessions).not.toHaveBeenCalled()
    expect(result.current.sessions).toEqual([])
  })

  it("passes filters to getSessions", async () => {
    vi.mocked(client.getSessions).mockResolvedValueOnce({ sessions: [] })

    const filters = { status: "running", project: "my-project" }
    const { result } = renderHook(() => useSessions(filters), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(client.getSessions).toHaveBeenCalledWith(filters)
  })

  it("exposes error message on API failure", async () => {
    vi.mocked(client.getSessions).mockRejectedValueOnce(new Error("API 503: Unavailable"))

    const { result } = renderHook(() => useSessions(), { wrapper })
    await waitFor(() => expect(result.current.error).toBe("API 503: Unavailable"))
    expect(result.current.loading).toBe(false)
  })

  it("uses separate cache keys for different filters", async () => {
    vi.mocked(client.getSessions)
      .mockResolvedValueOnce({ sessions: [{ id: "s1" } as any] })
      .mockResolvedValueOnce({ sessions: [{ id: "s2" } as any] })

    const { result: r1 } = renderHook(() => useSessions({ status: "running" }), { wrapper })
    const { result: r2 } = renderHook(() => useSessions({ status: "complete" }), { wrapper })

    await waitFor(() => expect(r1.current.loading).toBe(false))
    await waitFor(() => expect(r2.current.loading).toBe(false))

    expect(r1.current.sessions[0].id).toBe("s1")
    expect(r2.current.sessions[0].id).toBe("s2")
    expect(client.getSessions).toHaveBeenCalledTimes(2)
  })
})
