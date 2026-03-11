// @vitest-environment jsdom
import React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor, act } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useTaskMutation } from "../use-task-mutation"
import * as client from "@/api/client"

vi.mock("@/api/client")
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe("useTaskMutation", () => {
  let queryClient: QueryClient
  let wrapper: ReturnType<typeof makeWrapper>

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    wrapper = makeWrapper(queryClient)
    vi.resetAllMocks()
  })

  it("updateStatus sends correct Notion property format", async () => {
    vi.mocked(client.updateTask).mockResolvedValueOnce({ ok: true })

    const { result } = renderHook(() => useTaskMutation("task1"), { wrapper })

    act(() => result.current.updateStatus("In Progress"))

    await waitFor(() => {
      expect(client.updateTask).toHaveBeenCalledWith("task1", {
        Status: { status: { name: "In Progress" } },
      })
    })
  })

  it("updatePriority sends correct Notion property format", async () => {
    vi.mocked(client.updateTask).mockResolvedValueOnce({ ok: true })

    const { result } = renderHook(() => useTaskMutation("task1"), { wrapper })

    act(() => result.current.updatePriority("High"))

    await waitFor(() => {
      expect(client.updateTask).toHaveBeenCalledWith("task1", {
        Priority: { select: { name: "High" } },
      })
    })
  })

  it("updateTags sends correct Notion multi_select format", async () => {
    vi.mocked(client.updateTask).mockResolvedValueOnce({ ok: true })

    const { result } = renderHook(() => useTaskMutation("task1"), { wrapper })

    act(() => result.current.updateTags(["Bug", "Frontend"]))

    await waitFor(() => {
      expect(client.updateTask).toHaveBeenCalledWith("task1", {
        Tags: { multi_select: [{ name: "Bug" }, { name: "Frontend" }] },
      })
    })
  })

  it("updateAssignee sends correct Notion people format", async () => {
    vi.mocked(client.updateTask).mockResolvedValueOnce({ ok: true })

    const { result } = renderHook(() => useTaskMutation("task1"), { wrapper })

    act(() => result.current.updateAssignee("user-uuid"))

    await waitFor(() => {
      expect(client.updateTask).toHaveBeenCalledWith("task1", {
        Assignee: { people: [{ id: "user-uuid" }] },
      })
    })
  })

  it("shows error toast on failure", async () => {
    const { toast } = await import("sonner")
    vi.mocked(client.updateTask).mockRejectedValueOnce(new Error("Network error"))

    const { result } = renderHook(() => useTaskMutation("task1"), { wrapper })

    act(() => result.current.updateStatus("Done"))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Update failed: Network error")
    })
  })

  it("invalidates task queries on success", async () => {
    vi.mocked(client.updateTask).mockResolvedValueOnce({ ok: true })
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries")

    const { result } = renderHook(() => useTaskMutation("task1"), { wrapper })

    act(() => result.current.updateStatus("Done"))

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["task", "task1"] })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["tasks"] })
    })
  })
})
