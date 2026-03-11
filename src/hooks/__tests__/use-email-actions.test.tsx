// @vitest-environment jsdom
import React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor, act } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useEmailActions } from "../use-email-actions"
import * as client from "@/api/client"
import type { GmailThread } from "@/types"

vi.mock("@/api/client")
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function makeThread(overrides: Partial<GmailThread> = {}): GmailThread {
  return {
    id: "t1",
    subject: "Test",
    snippet: "",
    from: "test@example.com",
    date: "2024-01-01T00:00:00Z",
    labelIds: ["INBOX"],
    messages: [],
    ...overrides,
  } as GmailThread
}

describe("useEmailActions", () => {
  let queryClient: QueryClient
  let wrapper: ReturnType<typeof makeWrapper>

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    wrapper = makeWrapper(queryClient)
    vi.resetAllMocks()
  })

  it("returns correct isStarred/isImportant based on thread labels", () => {
    const thread = makeThread({ labelIds: ["INBOX", "STARRED"] })
    const { result } = renderHook(() => useEmailActions("t1", thread), { wrapper })

    expect(result.current.isStarred).toBe(true)
    expect(result.current.isImportant).toBe(false)
  })

  it("returns false for isStarred/isImportant when no thread", () => {
    const { result } = renderHook(() => useEmailActions("t1"), { wrapper })

    expect(result.current.isStarred).toBe(false)
    expect(result.current.isImportant).toBe(false)
  })

  it("archive calls modifyThreadLabels to remove INBOX", async () => {
    vi.mocked(client.modifyThreadLabels).mockResolvedValueOnce({ ok: true })
    const thread = makeThread()
    queryClient.setQueryData(["thread", "t1"], thread)

    const { result } = renderHook(() => useEmailActions("t1", thread), { wrapper })

    act(() => result.current.archive())

    await waitFor(() => {
      expect(client.modifyThreadLabels).toHaveBeenCalledWith("t1", { removeLabelIds: ["INBOX"] })
    })
  })

  it("archive optimistically removes INBOX label from cache", async () => {
    vi.mocked(client.modifyThreadLabels).mockResolvedValueOnce({ ok: true })
    const thread = makeThread({ labelIds: ["INBOX", "STARRED"] })
    queryClient.setQueryData(["thread", "t1"], thread)

    const { result } = renderHook(() => useEmailActions("t1", thread), { wrapper })

    act(() => result.current.archive())

    const cached = queryClient.getQueryData<GmailThread>(["thread", "t1"])
    expect(cached?.labelIds).toEqual(["STARRED"])
  })

  it("trash calls trashThread", async () => {
    vi.mocked(client.trashThread).mockResolvedValueOnce({ ok: true })
    const thread = makeThread()

    const { result } = renderHook(() => useEmailActions("t1", thread), { wrapper })

    act(() => result.current.trash())

    await waitFor(() => {
      expect(client.trashThread).toHaveBeenCalledWith("t1")
    })
  })

  it("toggleStar adds STARRED when not starred", async () => {
    vi.mocked(client.modifyThreadLabels).mockResolvedValueOnce({ ok: true })
    const thread = makeThread({ labelIds: ["INBOX"] })
    queryClient.setQueryData(["thread", "t1"], thread)

    const { result } = renderHook(() => useEmailActions("t1", thread), { wrapper })

    act(() => result.current.toggleStar())

    await waitFor(() => {
      expect(client.modifyThreadLabels).toHaveBeenCalledWith("t1", { addLabelIds: ["STARRED"] })
    })

    const cached = queryClient.getQueryData<GmailThread>(["thread", "t1"])
    expect(cached?.labelIds).toContain("STARRED")
  })

  it("toggleStar removes STARRED when already starred", async () => {
    vi.mocked(client.modifyThreadLabels).mockResolvedValueOnce({ ok: true })
    const thread = makeThread({ labelIds: ["INBOX", "STARRED"] })
    queryClient.setQueryData(["thread", "t1"], thread)

    const { result } = renderHook(() => useEmailActions("t1", thread), { wrapper })

    act(() => result.current.toggleStar())

    await waitFor(() => {
      expect(client.modifyThreadLabels).toHaveBeenCalledWith("t1", { removeLabelIds: ["STARRED"] })
    })

    const cached = queryClient.getQueryData<GmailThread>(["thread", "t1"])
    expect(cached?.labelIds).not.toContain("STARRED")
  })

  it("toggleImportant adds IMPORTANT when not important", async () => {
    vi.mocked(client.modifyThreadLabels).mockResolvedValueOnce({ ok: true })
    const thread = makeThread({ labelIds: ["INBOX"] })
    queryClient.setQueryData(["thread", "t1"], thread)

    const { result } = renderHook(() => useEmailActions("t1", thread), { wrapper })

    act(() => result.current.toggleImportant())

    await waitFor(() => {
      expect(client.modifyThreadLabels).toHaveBeenCalledWith("t1", { addLabelIds: ["IMPORTANT"] })
    })
  })

  it("rolls back optimistic update on error", async () => {
    vi.mocked(client.modifyThreadLabels).mockRejectedValueOnce(new Error("fail"))
    const thread = makeThread({ labelIds: ["INBOX"] })
    queryClient.setQueryData(["thread", "t1"], thread)

    const { result } = renderHook(() => useEmailActions("t1", thread), { wrapper })

    act(() => result.current.toggleStar())

    // Optimistic: STARRED added
    expect(queryClient.getQueryData<GmailThread>(["thread", "t1"])?.labelIds).toContain("STARRED")

    // After error: rolled back
    await waitFor(() => {
      expect(queryClient.getQueryData<GmailThread>(["thread", "t1"])?.labelIds).not.toContain("STARRED")
    })
  })
})
