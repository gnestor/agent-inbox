// @vitest-environment jsdom
import React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor, act } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import * as client from "@/api/client"

// Mocks for dependencies — hoisted so vi.mock can access them
const streamMockState = {
  connected: false,
  sessionStatus: null as string | null,
  pendingQuestion: null as any,
  presenceUsers: [] as any[],
  eventCount: 0,
  disconnect: vi.fn(),
  clearPendingQuestion: vi.fn(),
}

const mutationsMockState = {
  resume: { isPending: false, mutate: vi.fn() },
  abort: { isPending: false, mutate: vi.fn() },
  archive: { isPending: false, mutate: vi.fn() },
  unarchive: { isPending: false, mutate: vi.fn() },
  rename: { isPending: false, mutate: vi.fn() },
}

let lastMutationsOptions: any = null

vi.mock("@/api/client")
vi.mock("../use-session-stream", () => ({
  useSessionStream: vi.fn(() => streamMockState),
}))
vi.mock("../use-session-mutations", () => ({
  useSessionMutations: vi.fn((opts: any) => {
    lastMutationsOptions = opts
    return mutationsMockState
  }),
}))
vi.mock("@/lib/session-pipeline", () => ({
  processTranscript: vi.fn((msgs: any[]) => ({
    classified: msgs,
    lookups: { toolResults: new Map(), resolvedToolUseIDs: new Set(), authorEmails: [], fileMap: new Map(), fileIdMap: new Map() },
  })),
  filterVisible: vi.fn((msgs: any[]) => msgs),
}))
vi.mock("@/types/session-message", () => ({
  normalizeMessagePayload: vi.fn((m: any) => m),
}))

import { useSessionController as useSessionPhase } from "../use-session-controller"

const DEFAULT_VISIBILITY = { messages: true, toolCalls: true, thinking: true, artifacts: true }

function makeOpts(overrides: Record<string, any> = {}) {
  return { sessionId: "s1", visibility: DEFAULT_VISIBILITY, ...overrides }
}

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function resetStream(next: Partial<typeof streamMockState> = {}) {
  streamMockState.connected = next.connected ?? false
  streamMockState.sessionStatus = next.sessionStatus ?? null
  streamMockState.pendingQuestion = next.pendingQuestion ?? null
  streamMockState.presenceUsers = next.presenceUsers ?? []
  streamMockState.eventCount = next.eventCount ?? 0
}

function resetMutations() {
  mutationsMockState.resume = { isPending: false, mutate: vi.fn() }
  mutationsMockState.abort = { isPending: false, mutate: vi.fn() }
  mutationsMockState.archive = { isPending: false, mutate: vi.fn() }
  mutationsMockState.unarchive = { isPending: false, mutate: vi.fn() }
  mutationsMockState.rename = { isPending: false, mutate: vi.fn() }
}

describe("useSessionPhase", () => {
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
    resetStream()
    resetMutations()
    lastMutationsOptions = null
  })

  it("returns loading phase while the session query is pending", () => {
    // Never resolves
    vi.mocked(client.getSession).mockImplementation(() => new Promise(() => {}))

    const { result } = renderHook(
      () => useSessionPhase(makeOpts()),
      { wrapper },
    )

    expect(result.current.phase.status).toBe("loading")
  })

  it("returns error phase when the query fails", async () => {
    vi.mocked(client.getSession).mockRejectedValueOnce(new Error("Boom"))

    const { result } = renderHook(
      () => useSessionPhase(makeOpts()),
      { wrapper },
    )

    await waitFor(() => expect(result.current.phase.status).toBe("error"))
    if (result.current.phase.status === "error") {
      expect(result.current.phase.message).toBe("Boom")
    }
  })

  it("returns streaming phase when session is running and stream is connected", async () => {
    vi.mocked(client.getSession).mockResolvedValueOnce({
      session: { id: "s1", status: "running" } as any,
      messages: [],
    })
    resetStream({ connected: true, sessionStatus: "running" })

    const { result } = renderHook(
      () => useSessionPhase(makeOpts()),
      { wrapper },
    )

    await waitFor(() => expect(result.current.phase.status).toBe("streaming"))
  })

  it("returns loading phase when running but stream not yet connected", async () => {
    vi.mocked(client.getSession).mockResolvedValueOnce({
      session: { id: "s1", status: "running" } as any,
      messages: [],
    })
    resetStream({ connected: false, sessionStatus: "running" })

    const { result } = renderHook(
      () => useSessionPhase(makeOpts()),
      { wrapper },
    )

    // Wait for data to resolve, then confirm status
    await waitFor(() => expect(result.current.session).toBeDefined())
    expect(result.current.phase.status).toBe("loading")
  })

  it("returns awaiting_input phase with pending question", async () => {
    vi.mocked(client.getSession).mockResolvedValueOnce({
      session: { id: "s1", status: "awaiting_user_input" } as any,
      messages: [],
    })
    const question = { questions: [{ id: "q1", text: "Pick one", options: ["a", "b"] }] as any }
    resetStream({ connected: true, sessionStatus: "awaiting_user_input", pendingQuestion: question })

    const { result } = renderHook(
      () => useSessionPhase(makeOpts()),
      { wrapper },
    )

    await waitFor(() => expect(result.current.phase.status).toBe("awaiting_input"))
    if (result.current.phase.status === "awaiting_input") {
      expect(result.current.phase.question).toEqual(question)
    }
  })

  it("returns idle phase when complete and not streaming", async () => {
    vi.mocked(client.getSession).mockResolvedValueOnce({
      session: { id: "s1", status: "complete" } as any,
      messages: [],
    })
    resetStream({ connected: false, sessionStatus: null })

    const { result } = renderHook(
      () => useSessionPhase(makeOpts()),
      { wrapper },
    )

    await waitFor(() => expect(result.current.phase.status).toBe("idle"))
  })

  it("returns archived phase when session is archived", async () => {
    vi.mocked(client.getSession).mockResolvedValueOnce({
      session: { id: "s1", status: "archived" } as any,
      messages: [],
    })
    resetStream({ connected: true, sessionStatus: null })

    const { result } = renderHook(
      () => useSessionPhase(makeOpts()),
      { wrapper },
    )

    await waitFor(() => expect(result.current.phase.status).toBe("archived"))
  })

  it("returns sending phase when resume mutation is pending", async () => {
    vi.mocked(client.getSession).mockResolvedValueOnce({
      session: { id: "s1", status: "complete" } as any,
      messages: [],
    })
    mutationsMockState.resume = { isPending: true, mutate: vi.fn() }

    const { result } = renderHook(
      () => useSessionPhase(makeOpts()),
      { wrapper },
    )

    await waitFor(() => expect(result.current.phase.status).toBe("sending"))
  })

  it("passes onResume/onArchive callbacks through to mutations", async () => {
    vi.mocked(client.getSession).mockResolvedValueOnce({
      session: { id: "s1", status: "complete" } as any,
      messages: [],
    })
    const onResume = vi.fn()
    const onArchive = vi.fn()

    renderHook(
      () => useSessionPhase(makeOpts({ onResume, onArchive })),
      { wrapper },
    )

    expect(lastMutationsOptions).toMatchObject({ sessionId: "s1", onResume, onArchive })
  })

  it("resumeSession adds an optimistic user message and calls resume.mutate", async () => {
    vi.mocked(client.getSession).mockResolvedValueOnce({
      session: { id: "s1", status: "complete" } as any,
      messages: [],
    })

    const { result } = renderHook(
      () => useSessionPhase(makeOpts()),
      { wrapper },
    )

    await waitFor(() => expect(result.current.session).toBeDefined())

    act(() => {
      result.current.resumeSession("hello there")
    })

    const cached = queryClient.getQueryData<any>(["session", "s1"])
    expect(cached.messages).toHaveLength(1)
    expect(cached.messages[0].type).toBe("user")
    expect(cached.messages[0].sequence).toBeLessThan(0)
    expect(mutationsMockState.resume.mutate).toHaveBeenCalledWith("hello there")
  })

  it("returns messages from the cache", async () => {
    vi.mocked(client.getSession).mockResolvedValueOnce({
      session: { id: "s1", status: "complete" } as any,
      messages: [
        {
          id: 1,
          sessionId: "s1",
          sequence: 1,
          type: "user",
          message: { type: "user", content: "hi" },
          createdAt: "2026-01-01T00:00:00Z",
        } as any,
      ],
    })

    const { result } = renderHook(
      () => useSessionPhase(makeOpts()),
      { wrapper },
    )

    await waitFor(() => expect(result.current.messages.length).toBe(1))
    expect(result.current.messages[0].sequence).toBe(1)
  })
})
