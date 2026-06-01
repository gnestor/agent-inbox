// @vitest-environment jsdom
import React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor, act } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import type { SessionSlice } from "@/stores/session-store"
import type { Session } from "@/types"

// Mocks — must be declared before the target module is imported
const mutationsMockState = {
  resume: { isPending: false, mutate: vi.fn() },
  abort: { isPending: false, mutate: vi.fn() },
  archive: { isPending: false, mutate: vi.fn() },
  unarchive: { isPending: false, mutate: vi.fn() },
  rename: { isPending: false, mutate: vi.fn() },
}
let lastMutationsOptions: any = null

let sliceMock: SessionSlice | undefined

vi.mock("../use-session-transcript", () => ({
  useSessionTranscript: vi.fn(() => sliceMock),
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
vi.mock("@/api/client", () => ({
  answerSessionQuestion: vi.fn(),
  getUserProfiles: vi.fn(() => Promise.resolve({ users: [] })),
}))

// Import AFTER mocks are registered
import { useSessionController } from "../use-session-controller"
import { useSessionStore } from "@/stores/session-store"

const DEFAULT_VISIBILITY = { messages: true, toolCalls: true, thinking: true, artifacts: true }

function makeOpts(overrides: Record<string, any> = {}) {
  return { sessionId: "s1", visibility: DEFAULT_VISIBILITY, ...overrides }
}

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "s1",
    status: "running",
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

function makeSlice(overrides: Partial<SessionSlice> = {}): SessionSlice {
  return {
    session: makeSession(),
    messageIds: [],
    messageById: {},
    pendingPrompts: [],
    pendingQuestion: null,
    presence: [],
    recovery: {
      latestSequence: 0,
      highestObservedSequence: 0,
      bootstrapped: true,
      pendingReplay: false,
      inFlight: null,
    },
    deferredEvents: [],
    ...overrides,
  }
}

function resetMutations() {
  mutationsMockState.resume = { isPending: false, mutate: vi.fn() }
  mutationsMockState.abort = { isPending: false, mutate: vi.fn() }
  mutationsMockState.archive = { isPending: false, mutate: vi.fn() }
  mutationsMockState.unarchive = { isPending: false, mutate: vi.fn() }
  mutationsMockState.rename = { isPending: false, mutate: vi.fn() }
}

describe("useSessionController (phase derivation)", () => {
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
    sliceMock = undefined
    resetMutations()
    lastMutationsOptions = null
    // Clear store
    const s = useSessionStore.getState()
    for (const id of Object.keys(s.sessions)) s.removeSession(id)
  })

  it("returns loading phase when the slice hasn't bootstrapped yet", () => {
    sliceMock = undefined // no slice yet
    const { result } = renderHook(() => useSessionController(makeOpts()), { wrapper })
    expect(result.current.phase.status).toBe("loading")
  })

  it("returns loading phase when bootstrap is still in flight", () => {
    sliceMock = makeSlice({
      recovery: {
        latestSequence: 0,
        highestObservedSequence: 0,
        bootstrapped: false,
        pendingReplay: false,
        inFlight: { kind: "snapshot", reason: "bootstrap" },
      },
    })
    const { result } = renderHook(() => useSessionController(makeOpts()), { wrapper })
    expect(result.current.phase.status).toBe("loading")
  })

  it("Scenario: `useSessionController` exposes a `phase` discriminated union — returns streaming phase when bootstrapped and session is running", () => {
    sliceMock = makeSlice({ session: makeSession({ status: "running" }) })
    const { result } = renderHook(() => useSessionController(makeOpts()), { wrapper })
    expect(result.current.phase.status).toBe("streaming")
  })

  it("returns awaiting_input phase when pendingQuestion is set", () => {
    const question = { questions: [{ id: "q1" } as any] }
    sliceMock = makeSlice({
      session: makeSession({ status: "awaiting_user_input" }),
      pendingQuestion: question as any,
    })
    const { result } = renderHook(() => useSessionController(makeOpts()), { wrapper })
    expect(result.current.phase.status).toBe("awaiting_input")
    if (result.current.phase.status === "awaiting_input") {
      expect(result.current.phase.question).toEqual(question)
    }
  })

  it("returns sending phase when resume mutation is pending", () => {
    sliceMock = makeSlice({ session: makeSession({ status: "complete" }) })
    mutationsMockState.resume = { isPending: true, mutate: vi.fn() }
    const { result } = renderHook(() => useSessionController(makeOpts()), { wrapper })
    expect(result.current.phase.status).toBe("sending")
  })

  it("returns idle phase when bootstrapped and status is complete", () => {
    sliceMock = makeSlice({ session: makeSession({ status: "complete" }) })
    const { result } = renderHook(() => useSessionController(makeOpts()), { wrapper })
    expect(result.current.phase.status).toBe("idle")
  })

  it("returns errored phase when status is errored", () => {
    sliceMock = makeSlice({ session: makeSession({ status: "errored" }) })
    const { result } = renderHook(() => useSessionController(makeOpts()), { wrapper })
    expect(result.current.phase.status).toBe("errored")
  })

  it("returns archived phase when status is archived", () => {
    sliceMock = makeSlice({ session: makeSession({ status: "archived" }) })
    const { result } = renderHook(() => useSessionController(makeOpts()), { wrapper })
    expect(result.current.phase.status).toBe("archived")
  })

  it("passes onResume/onArchive through to mutations", () => {
    sliceMock = makeSlice()
    const onResume = vi.fn()
    const onArchive = vi.fn()
    renderHook(() => useSessionController(makeOpts({ onResume, onArchive })), { wrapper })
    expect(lastMutationsOptions).toMatchObject({ sessionId: "s1", onResume, onArchive })
  })

  it("resumeSession submits an optimistic prompt and calls resume.mutate", async () => {
    // Seed the store with an existing slice so submitOptimisticPrompt has somewhere to write
    useSessionStore.getState().beginSnapshot("s1", "bootstrap")
    useSessionStore.getState().applySnapshot("s1", {
      session: makeSession({ status: "complete" }),
      messages: [],
    })
    // After applySnapshot the real store has our slice; use it as the mock.
    sliceMock = useSessionStore.getState().sessions["s1"]

    const { result } = renderHook(() => useSessionController(makeOpts()), { wrapper })

    act(() => {
      result.current.resumeSession("hello there")
    })

    const updated = useSessionStore.getState().sessions["s1"]!
    expect(updated.pendingPrompts).toHaveLength(1)
    expect(updated.pendingPrompts[0]!.prompt).toBe("hello there")
    expect(updated.session.status).toBe("running")
    expect(mutationsMockState.resume.mutate).toHaveBeenCalledWith("hello there")
  })

  it("Scenario: Controller filters classified messages by visibility — exposes combined real + optimistic messages via the pipeline", async () => {
    sliceMock = makeSlice({
      messageIds: [1],
      messageById: {
        1: {
          id: 1,
          sessionId: "s1",
          sequence: 1,
          type: "user",
          message: { type: "user", content: "hi" } as any,
          createdAt: "2026-01-01T00:00:00Z",
        },
      },
      pendingPrompts: [{ localId: "a", prompt: "pending", createdAt: "2026-01-01T00:00:00Z" }],
    })
    const { result } = renderHook(() => useSessionController(makeOpts()), { wrapper })

    await waitFor(() => expect(result.current.messages.length).toBe(2))
    // processTranscript is mocked to pass messages through unwrapped
    const raw = result.current.messages as unknown as Array<{ sequence: number }>
    expect(raw[0]!.sequence).toBe(1)
    expect(raw[1]!.sequence).toBeGreaterThan(1000)
  })
})

describe("answerQuestion", () => {
  let queryClient: QueryClient
  let wrapper: ReturnType<typeof makeWrapper>

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    wrapper = makeWrapper(queryClient)
    sliceMock = undefined
    resetMutations()
    lastMutationsOptions = null
    const s = useSessionStore.getState()
    for (const id of Object.keys(s.sessions)) s.removeSession(id)
  })

  async function seedSlicedWithQuestion() {
    useSessionStore.getState().beginSnapshot("s1", "bootstrap")
    useSessionStore.getState().applySnapshot("s1", {
      session: makeSession({ status: "awaiting_user_input" }),
      messages: [],
    })
    const question = { questions: [{ question: "?", header: "Q", options: [], multiSelect: false }] as any }
    useSessionStore.getState().setPendingQuestion("s1", question)
    sliceMock = useSessionStore.getState().sessions["s1"]
    return question
  }

  it("clears pending question optimistically before the HTTP call", async () => {
    const question = await seedSlicedWithQuestion()
    const answerSpy = vi.mocked(await import("@/api/client")).answerSessionQuestion
    let resolveHttp: () => void = () => {}
    answerSpy.mockImplementation(() => new Promise<any>((r) => { resolveHttp = () => r(undefined) }))

    const { result } = renderHook(() => useSessionController(makeOpts()), { wrapper })

    let pending: Promise<void> = Promise.resolve()
    await act(async () => {
      pending = result.current.answerQuestion({ q1: "a" })
    })
    // HTTP still in flight but the store already cleared.
    expect(useSessionStore.getState().sessions["s1"]?.pendingQuestion).toBeNull()
    expect(question).toBeTruthy() // sanity: we had one to begin with

    await act(async () => { resolveHttp(); await pending })
  })

  it("restores the pending question if the HTTP call fails", async () => {
    const question = await seedSlicedWithQuestion()
    const answerSpy = vi.mocked(await import("@/api/client")).answerSessionQuestion
    answerSpy.mockRejectedValueOnce(new Error("network down"))

    const { result } = renderHook(() => useSessionController(makeOpts()), { wrapper })

    await act(async () => {
      await expect(result.current.answerQuestion({ q1: "a" })).rejects.toThrow("network down")
    })

    expect(useSessionStore.getState().sessions["s1"]?.pendingQuestion).toEqual(question)
  })

  it("submits even when slice.pendingQuestion is already null (transcript-driven form)", async () => {
    // Seed a slice with NO pendingQuestion — simulates the state after a
    // server restart or when the session's DB status has moved past
    // awaiting_user_input. The transcript still shows the form based on the
    // tool_use having no result, and the server's /answer fallback resumes
    // via a prompt.
    useSessionStore.getState().beginSnapshot("s1", "bootstrap")
    useSessionStore.getState().applySnapshot("s1", {
      session: makeSession({ status: "complete" }),
      messages: [],
    })
    expect(useSessionStore.getState().sessions["s1"]?.pendingQuestion).toBeNull()
    sliceMock = useSessionStore.getState().sessions["s1"]

    const answerSpy = vi.mocked(await import("@/api/client")).answerSessionQuestion
    answerSpy.mockResolvedValueOnce(undefined as any)

    const { result } = renderHook(() => useSessionController(makeOpts()), { wrapper })
    await act(async () => {
      await result.current.answerQuestion({ q1: "Other: custom" })
    })

    expect(answerSpy).toHaveBeenCalledWith("s1", { q1: "Other: custom" })
  })
})
