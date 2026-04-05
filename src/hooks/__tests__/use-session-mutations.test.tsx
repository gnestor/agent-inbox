// @vitest-environment jsdom
import React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor, act } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useSessionMutations } from "../use-session-mutations"
import * as client from "@/api/client"

vi.mock("@/api/client")
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe("useSessionMutations", () => {
  let queryClient: QueryClient
  let wrapper: ReturnType<typeof makeWrapper>

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    wrapper = makeWrapper(queryClient)
    vi.resetAllMocks()
  })

  it("resume mutation calls resumeSession API and triggers onResume", async () => {
    const onResume = vi.fn()
    vi.mocked(client.resumeSession).mockResolvedValueOnce(undefined as any)

    const { result } = renderHook(
      () => useSessionMutations({ sessionId: "s1", onResume }),
      { wrapper },
    )

    act(() => {
      result.current.resume.mutate("continue please")
    })

    await waitFor(() => expect(result.current.resume.isSuccess).toBe(true))
    expect(client.resumeSession).toHaveBeenCalledWith("s1", "continue please")
    expect(onResume).toHaveBeenCalled()
  })

  it("resume mutation optimistically sets status to running", async () => {
    // Seed cache with a session
    queryClient.setQueryData(["session", "s1"], {
      session: { id: "s1", status: "complete" },
      messages: [],
    })

    vi.mocked(client.resumeSession).mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 50)),
    )

    const { result } = renderHook(
      () => useSessionMutations({ sessionId: "s1" }),
      { wrapper },
    )

    act(() => {
      result.current.resume.mutate("go")
    })

    // Check optimistic update immediately
    const cached = queryClient.getQueryData<any>(["session", "s1"])
    expect(cached.session.status).toBe("running")
  })

  it("abort mutation calls abortSession API", async () => {
    vi.mocked(client.abortSession).mockResolvedValueOnce(undefined as any)

    const { result } = renderHook(
      () => useSessionMutations({ sessionId: "s1" }),
      { wrapper },
    )

    act(() => {
      result.current.abort.mutate()
    })

    await waitFor(() => expect(result.current.abort.isSuccess).toBe(true))
    expect(client.abortSession).toHaveBeenCalledWith("s1")
  })

  it("abort mutation optimistically sets status to complete", async () => {
    queryClient.setQueryData(["session", "s1"], {
      session: { id: "s1", status: "running" },
      messages: [],
    })

    vi.mocked(client.abortSession).mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 50)),
    )

    const { result } = renderHook(
      () => useSessionMutations({ sessionId: "s1" }),
      { wrapper },
    )

    act(() => {
      result.current.abort.mutate()
    })

    const cached = queryClient.getQueryData<any>(["session", "s1"])
    expect(cached.session.status).toBe("complete")
  })

  it("archive mutation calls archiveSession and triggers onArchive", async () => {
    const onArchive = vi.fn()
    vi.mocked(client.archiveSession).mockResolvedValueOnce(undefined as any)

    queryClient.setQueryData(["session", "s1"], {
      session: { id: "s1", status: "complete" },
      messages: [],
    })

    const { result } = renderHook(
      () => useSessionMutations({ sessionId: "s1", onArchive }),
      { wrapper },
    )

    act(() => {
      result.current.archive.mutate()
    })

    await waitFor(() => expect(result.current.archive.isSuccess).toBe(true))
    expect(client.archiveSession).toHaveBeenCalledWith("s1")
    expect(onArchive).toHaveBeenCalled()
  })

  it("archive mutation optimistically sets status to archived", async () => {
    queryClient.setQueryData(["session", "s1"], {
      session: { id: "s1", status: "complete" },
      messages: [],
    })

    vi.mocked(client.archiveSession).mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 200)),
    )

    const { result } = renderHook(
      () => useSessionMutations({ sessionId: "s1" }),
      { wrapper },
    )

    act(() => {
      result.current.archive.mutate()
    })

    await waitFor(() => {
      const cached = queryClient.getQueryData<any>(["session", "s1"])
      expect(cached.session.status).toBe("archived")
    })
  })

  it("unarchive mutation calls unarchiveSession API", async () => {
    vi.mocked(client.unarchiveSession).mockResolvedValueOnce(undefined as any)

    queryClient.setQueryData(["session", "s1"], {
      session: { id: "s1", status: "archived" },
      messages: [],
    })

    const { result } = renderHook(
      () => useSessionMutations({ sessionId: "s1" }),
      { wrapper },
    )

    act(() => {
      result.current.unarchive.mutate()
    })

    await waitFor(() => expect(result.current.unarchive.isSuccess).toBe(true))
    expect(client.unarchiveSession).toHaveBeenCalledWith("s1")
  })

  it("unarchive mutation optimistically sets status to complete", async () => {
    queryClient.setQueryData(["session", "s1"], {
      session: { id: "s1", status: "archived" },
      messages: [],
    })

    vi.mocked(client.unarchiveSession).mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 200)),
    )

    const { result } = renderHook(
      () => useSessionMutations({ sessionId: "s1" }),
      { wrapper },
    )

    act(() => {
      result.current.unarchive.mutate()
    })

    await waitFor(() => {
      const cached = queryClient.getQueryData<any>(["session", "s1"])
      expect(cached.session.status).toBe("complete")
    })
  })

  it("rename mutation calls updateSession with new title", async () => {
    vi.mocked(client.updateSession).mockResolvedValueOnce(undefined as any)

    queryClient.setQueryData(["session", "s1"], {
      session: { id: "s1", status: "complete", summary: "Old Title" },
      messages: [],
    })

    const { result } = renderHook(
      () => useSessionMutations({ sessionId: "s1" }),
      { wrapper },
    )

    act(() => {
      result.current.rename.mutate("New Title")
    })

    await waitFor(() => expect(result.current.rename.isSuccess).toBe(true))
    expect(client.updateSession).toHaveBeenCalledWith("s1", { summary: "New Title" })
  })

  it("rename mutation optimistically updates summary in cache", async () => {
    queryClient.setQueryData(["session", "s1"], {
      session: { id: "s1", status: "complete", summary: "Old Title" },
      messages: [],
    })

    vi.mocked(client.updateSession).mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 200)),
    )

    const { result } = renderHook(
      () => useSessionMutations({ sessionId: "s1" }),
      { wrapper },
    )

    act(() => {
      result.current.rename.mutate("New Title")
    })

    // Wait for the async onMutate to apply the optimistic update
    await waitFor(() => {
      const cached = queryClient.getQueryData<any>(["session", "s1"])
      expect(cached.session.summary).toBe("New Title")
    })
  })

  it("rename mutation rolls back on error", async () => {
    const originalData = {
      session: { id: "s1", status: "complete", summary: "Original" },
      messages: [],
    }
    queryClient.setQueryData(["session", "s1"], originalData)

    vi.mocked(client.updateSession).mockRejectedValueOnce(new Error("Network error"))

    const { result } = renderHook(
      () => useSessionMutations({ sessionId: "s1" }),
      { wrapper },
    )

    act(() => {
      result.current.rename.mutate("Will Fail")
    })

    await waitFor(() => expect(result.current.rename.isError).toBe(true))

    // Should have rolled back to original data
    const cached = queryClient.getQueryData<any>(["session", "s1"])
    expect(cached.session.summary).toBe("Original")
  })

  it("archive mutation also updates the sessions list cache", async () => {
    queryClient.setQueryData(["session", "s1"], {
      session: { id: "s1", status: "complete" },
      messages: [],
    })
    queryClient.setQueryData(["sessions"], {
      sessions: [
        { id: "s1", status: "complete" },
        { id: "s2", status: "running" },
      ],
    })

    vi.mocked(client.archiveSession).mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 200)),
    )

    const { result } = renderHook(
      () => useSessionMutations({ sessionId: "s1" }),
      { wrapper },
    )

    act(() => {
      result.current.archive.mutate()
    })

    // Wait for async onMutate to apply optimistic updates
    await waitFor(() => {
      const listCache = queryClient.getQueryData<any>(["sessions"])
      const s1 = listCache.sessions.find((s: any) => s.id === "s1")
      expect(s1.status).toBe("archived")
    })

    // Other sessions should be untouched
    const listCache = queryClient.getQueryData<any>(["sessions"])
    const s2 = listCache.sessions.find((s: any) => s.id === "s2")
    expect(s2.status).toBe("running")
  })
})
