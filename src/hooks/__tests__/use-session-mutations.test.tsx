// @vitest-environment jsdom
import React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor, act } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useSessionMutations } from "../use-session-mutations"
import * as client from "@/api/client"
import { useSessionStore } from "@/stores/session-store"
import type { Session } from "@/types"

vi.mock("@/api/client")
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "s1",
    status: "complete",
    prompt: "",
    summary: null,
    startedAt: "2026-04-22T00:00:00Z",
    updatedAt: "2026-04-22T00:00:00Z",
    completedAt: null,
    linkedSourceType: null,
    linkedSourceId: null,
    triggerSource: "manual",
    project: "demo",
    linkedItemTitle: null,
    ...overrides,
  }
}

function seedSlice(sessionId = "s1", sessionOverrides: Partial<Session> = {}) {
  const store = useSessionStore.getState()
  store.beginSnapshot(sessionId, "bootstrap")
  store.applySnapshot(sessionId, {
    session: makeSession({ id: sessionId, ...sessionOverrides }),
    messages: [],
  })
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
    // Reset the store between tests
    const s = useSessionStore.getState()
    for (const id of Object.keys(s.sessions)) s.removeSession(id)
  })

  it("Scenario: Controller exposes mutations bag — resume mutation calls resumeSession API and triggers onResume", async () => {
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

  it("resume mutation optimistically sets sessions list status to running", async () => {
    queryClient.setQueryData(["sessions"], { sessions: [{ id: "s1", status: "complete" }] })
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

    const listCache = queryClient.getQueryData<any>(["sessions"])
    expect(listCache.sessions[0].status).toBe("running")
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

  it("abort mutation optimistically flips store status to complete", async () => {
    seedSlice("s1", { status: "running" })
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

    expect(useSessionStore.getState().sessions["s1"]?.session.status).toBe("complete")
  })

  it("archive mutation calls archiveSession and triggers onArchive", async () => {
    const onArchive = vi.fn()
    vi.mocked(client.archiveSession).mockResolvedValueOnce(undefined as any)
    seedSlice("s1", { status: "complete" })

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

  it("archive mutation optimistically flips store status to archived", async () => {
    seedSlice("s1", { status: "complete" })
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
      expect(useSessionStore.getState().sessions["s1"]?.session.status).toBe("archived")
    })
  })

  it("unarchive mutation calls unarchiveSession API", async () => {
    vi.mocked(client.unarchiveSession).mockResolvedValueOnce(undefined as any)
    seedSlice("s1", { status: "archived" })

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

  it("unarchive mutation optimistically flips store status to complete", async () => {
    seedSlice("s1", { status: "archived" })
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
      expect(useSessionStore.getState().sessions["s1"]?.session.status).toBe("complete")
    })
  })

  it("rename mutation calls updateSession with new title", async () => {
    vi.mocked(client.updateSession).mockResolvedValueOnce(undefined as any)
    seedSlice("s1", { summary: "Old Title" })

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

  it("rename mutation optimistically updates summary in the store", async () => {
    seedSlice("s1", { summary: "Old Title" })
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

    await waitFor(() => {
      expect(useSessionStore.getState().sessions["s1"]?.session.summary).toBe("New Title")
    })
  })

  it("rename mutation rolls back on error", async () => {
    seedSlice("s1", { summary: "Original" })
    vi.mocked(client.updateSession).mockRejectedValueOnce(new Error("Network error"))

    const { result } = renderHook(
      () => useSessionMutations({ sessionId: "s1" }),
      { wrapper },
    )

    act(() => {
      result.current.rename.mutate("Will Fail")
    })

    await waitFor(() => expect(result.current.rename.isError).toBe(true))

    expect(useSessionStore.getState().sessions["s1"]?.session.summary).toBe("Original")
  })

  it("archive mutation also updates the sessions list cache", async () => {
    seedSlice("s1", { status: "complete" })
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

    await waitFor(() => {
      const listCache = queryClient.getQueryData<any>(["sessions"])
      const s1 = listCache.sessions.find((s: any) => s.id === "s1")
      expect(s1.status).toBe("archived")
    })

    const listCache = queryClient.getQueryData<any>(["sessions"])
    const s2 = listCache.sessions.find((s: any) => s.id === "s2")
    expect(s2.status).toBe("running")
  })
})
