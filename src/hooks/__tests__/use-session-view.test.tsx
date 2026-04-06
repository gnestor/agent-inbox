// @vitest-environment jsdom
import React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act } from "@testing-library/react"

// Mocks for dependencies
const navActionsMock = {
  removePanel: vi.fn(),
  pushPanel: vi.fn(),
}

let currentLocation = { pathname: "/recent/s1" }

vi.mock("react-router-dom", () => ({
  useLocation: () => currentLocation,
}))

vi.mock("@/lib/navigation-store", () => ({
  useNavActions: () => navActionsMock,
}))

// Mock idb-keyval so IndexedDB is not needed in tests
const idbStore: Record<string, unknown> = {}
vi.mock("idb-keyval", () => ({
  get: vi.fn((key: string) => Promise.resolve(idbStore[key])),
  set: vi.fn((key: string, val: unknown) => { idbStore[key] = val; return Promise.resolve() }),
  del: vi.fn((key: string) => { delete idbStore[key]; return Promise.resolve() }),
}))

import { useSessionView } from "../use-session-view"
import type { SessionPhase } from "../use-session-controller"

function makeMutations() {
  return {
    rename: { mutate: vi.fn() },
  }
}

function makeOptions(overrides: Partial<Parameters<typeof useSessionView>[0]> = {}) {
  return {
    sessionId: "s1",
    panelId: "detail:s1",
    title: undefined,
    session: { id: "s1", status: "complete", summary: "My Session" } as any,
    phase: { status: "idle" } as SessionPhase,
    mutations: makeMutations(),
    resumeSession: vi.fn(),
    ...overrides,
  }
}

describe("useSessionView", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    navActionsMock.removePanel = vi.fn()
    navActionsMock.pushPanel = vi.fn()
    currentLocation = { pathname: "/recent/s1" }
    // Clear idb store
    for (const key of Object.keys(idbStore)) delete idbStore[key]
  })

  it("initial state has no editing active and exposes displayTitle", () => {
    const opts = makeOptions()
    const { result } = renderHook(() => useSessionView(opts))

    expect(result.current.isEditing).toBe(false)
    expect(result.current.editTitle).toBe("")
    expect(result.current.displayTitle).toBe("My Session")
    expect(result.current.isStreaming).toBe(false)
    expect(result.current.isSending).toBe(false)
  })

  it("displayTitle falls back through linkedItemTitle → summary → title → prompt", () => {
    // linkedItemTitle wins
    const r1 = renderHook(() =>
      useSessionView(makeOptions({
        session: { id: "s1", linkedItemTitle: "Linked", summary: "Sum", prompt: "Do stuff" } as any,
        title: "Title prop",
      })),
    )
    expect(r1.result.current.displayTitle).toBe("Linked")

    // summary next
    const r2 = renderHook(() =>
      useSessionView(makeOptions({
        session: { id: "s1", summary: "Sum", prompt: "Do stuff" } as any,
        title: "Title prop",
      })),
    )
    expect(r2.result.current.displayTitle).toBe("Sum")

    // title prop next
    const r3 = renderHook(() =>
      useSessionView(makeOptions({
        session: { id: "s1", prompt: "Do stuff" } as any,
        title: "Title prop",
      })),
    )
    expect(r3.result.current.displayTitle).toBe("Title prop")

    // prompt last
    const r4 = renderHook(() =>
      useSessionView(makeOptions({
        session: { id: "s1", prompt: "Do stuff" } as any,
        title: undefined,
      })),
    )
    expect(r4.result.current.displayTitle).toBe("Do stuff")
  })

  it("handleBack calls removePanel with the panelId", () => {
    const opts = makeOptions({ panelId: "detail:xyz" })
    const { result } = renderHook(() => useSessionView(opts))

    act(() => result.current.handleBack())
    expect(navActionsMock.removePanel).toHaveBeenCalledWith("detail:xyz")
  })

  it("handleStartEdit enables editing with current summary", () => {
    const opts = makeOptions({
      session: { id: "s1", summary: "Current Summary" } as any,
    })
    const { result } = renderHook(() => useSessionView(opts))

    act(() => result.current.handleStartEdit())
    expect(result.current.isEditing).toBe(true)
    expect(result.current.editTitle).toBe("Current Summary")
  })

  it("handleFinishEdit calls rename.mutate when title changed", () => {
    const mutations = makeMutations()
    const opts = makeOptions({
      session: { id: "s1", summary: "Old" } as any,
      mutations,
    })
    const { result } = renderHook(() => useSessionView(opts))

    act(() => result.current.handleStartEdit())
    act(() => result.current.setEditTitle("New Title"))
    act(() => result.current.handleFinishEdit())

    expect(result.current.isEditing).toBe(false)
    expect(mutations.rename.mutate).toHaveBeenCalledWith("New Title")
  })

  it("handleFinishEdit does not call rename.mutate when title unchanged", () => {
    const mutations = makeMutations()
    const opts = makeOptions({
      session: { id: "s1", summary: "Same" } as any,
      mutations,
    })
    const { result } = renderHook(() => useSessionView(opts))

    act(() => result.current.handleStartEdit())
    act(() => result.current.handleFinishEdit())

    expect(mutations.rename.mutate).not.toHaveBeenCalled()
  })

  it("handleFinishEdit does not call rename.mutate when title is empty", () => {
    const mutations = makeMutations()
    const opts = makeOptions({
      session: { id: "s1", summary: "Old" } as any,
      mutations,
    })
    const { result } = renderHook(() => useSessionView(opts))

    act(() => result.current.handleStartEdit())
    act(() => result.current.setEditTitle("   "))
    act(() => result.current.handleFinishEdit())

    expect(mutations.rename.mutate).not.toHaveBeenCalled()
  })

  it("handleEditKeyDown: Enter finishes edit, Escape cancels", () => {
    const mutations = makeMutations()
    const opts = makeOptions({
      session: { id: "s1", summary: "Old" } as any,
      mutations,
    })
    const { result } = renderHook(() => useSessionView(opts))

    act(() => result.current.handleStartEdit())
    act(() => result.current.setEditTitle("Pressed Enter"))

    const enterEvent = { key: "Enter", preventDefault: vi.fn() } as any
    act(() => result.current.handleEditKeyDown(enterEvent))

    expect(enterEvent.preventDefault).toHaveBeenCalled()
    expect(result.current.isEditing).toBe(false)
    expect(mutations.rename.mutate).toHaveBeenCalledWith("Pressed Enter")

    // Now test Escape
    act(() => result.current.handleStartEdit())
    const escEvent = { key: "Escape", preventDefault: vi.fn() } as any
    act(() => result.current.handleEditKeyDown(escEvent))
    expect(result.current.isEditing).toBe(false)
  })

  it("handleSend calls resumeSession with prompt and does not send when empty", () => {
    const resumeSession = vi.fn()
    const { result } = renderHook(() =>
      useSessionView(makeOptions({ resumeSession })),
    )

    // Empty prompt → no-op
    act(() => result.current.handleSend())
    expect(resumeSession).not.toHaveBeenCalled()

    // Set prompt via setPrompt, then send
    act(() => result.current.setPrompt("hello agent"))
    act(() => result.current.handleSend())
    expect(resumeSession).toHaveBeenCalledWith("hello agent")
  })

  it("handleSend is a no-op while sending", () => {
    const resumeSession = vi.fn()
    const { result } = renderHook(() =>
      useSessionView(makeOptions({
        resumeSession,
        phase: { status: "sending" } as SessionPhase,
      })),
    )

    // Set a non-empty prompt
    act(() => result.current.setPrompt("hi"))

    expect(result.current.isSending).toBe(true)
    act(() => result.current.handleSend())
    expect(resumeSession).not.toHaveBeenCalled()
  })

  it("setPrompt updates the prompt value", () => {
    const resumeSession = vi.fn()
    const { result } = renderHook(() => useSessionView(makeOptions({ resumeSession })))

    act(() => result.current.setPrompt("typed text"))
    // Verify by sending — it should use the value we set
    act(() => result.current.handleSend())
    expect(resumeSession).toHaveBeenCalledWith("typed text")
  })

  it("handleOpenPanel pushes an output panel", () => {
    const { result } = renderHook(() => useSessionView(makeOptions()))
    const spec = { type: "code", content: "x" } as any
    act(() => result.current.handleOpenPanel(spec, 42))

    expect(navActionsMock.pushPanel).toHaveBeenCalledWith({
      id: "output:s1:42",
      type: "output",
      props: { sessionId: "s1", sequence: 42, outputType: "code", spec },
    })
  })

  it("isFromSidebar is true only when pathname starts with /recent/", () => {
    currentLocation = { pathname: "/recent/s1" }
    const r1 = renderHook(() => useSessionView(makeOptions()))
    expect(r1.result.current.isFromSidebar).toBe(true)

    currentLocation = { pathname: "/sessions/s1" }
    const r2 = renderHook(() => useSessionView(makeOptions()))
    expect(r2.result.current.isFromSidebar).toBe(false)
  })

  it("isStreaming reflects phase.status === 'streaming'", () => {
    const { result } = renderHook(() =>
      useSessionView(makeOptions({ phase: { status: "streaming" } as SessionPhase })),
    )
    expect(result.current.isStreaming).toBe(true)
    expect(result.current.isSending).toBe(false)
  })
})
