// @vitest-environment jsdom
import React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor, act } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useCalendarMutation } from "../use-calendar-mutation"
import * as client from "@/api/client"

vi.mock("@/api/client")
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe("useCalendarMutation", () => {
  let queryClient: QueryClient
  let wrapper: ReturnType<typeof makeWrapper>

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    wrapper = makeWrapper(queryClient)
    vi.resetAllMocks()
  })

  it("updateStatus sends correct Notion property format", async () => {
    vi.mocked(client.updateCalendarItem).mockResolvedValueOnce({ ok: true })

    const { result } = renderHook(() => useCalendarMutation("cal1"), { wrapper })

    act(() => result.current.updateStatus("Done"))

    await waitFor(() => {
      expect(client.updateCalendarItem).toHaveBeenCalledWith("cal1", {
        Status: { status: { name: "Done" } },
      })
    })
  })

  it("updateTags sends correct Notion multi_select format", async () => {
    vi.mocked(client.updateCalendarItem).mockResolvedValueOnce({ ok: true })

    const { result } = renderHook(() => useCalendarMutation("cal1"), { wrapper })

    act(() => result.current.updateTags(["Meeting", "Weekly"]))

    await waitFor(() => {
      expect(client.updateCalendarItem).toHaveBeenCalledWith("cal1", {
        Tags: { multi_select: [{ name: "Meeting" }, { name: "Weekly" }] },
      })
    })
  })

  it("updateDate sends correct Notion date format", async () => {
    vi.mocked(client.updateCalendarItem).mockResolvedValueOnce({ ok: true })

    const { result } = renderHook(() => useCalendarMutation("cal1"), { wrapper })

    act(() => result.current.updateDate("2024-03-15"))

    await waitFor(() => {
      expect(client.updateCalendarItem).toHaveBeenCalledWith("cal1", {
        Date: { date: { start: "2024-03-15" } },
      })
    })
  })

  it("updateAssignee sends correct Notion people format", async () => {
    vi.mocked(client.updateCalendarItem).mockResolvedValueOnce({ ok: true })

    const { result } = renderHook(() => useCalendarMutation("cal1"), { wrapper })

    act(() => result.current.updateAssignee("user-uuid"))

    await waitFor(() => {
      expect(client.updateCalendarItem).toHaveBeenCalledWith("cal1", {
        Assignee: { people: [{ id: "user-uuid" }] },
      })
    })
  })

  it("shows error toast on failure", async () => {
    const { toast } = await import("sonner")
    vi.mocked(client.updateCalendarItem).mockRejectedValueOnce(new Error("API error"))

    const { result } = renderHook(() => useCalendarMutation("cal1"), { wrapper })

    act(() => result.current.updateStatus("Done"))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Update failed: API error")
    })
  })

  it("invalidates calendar queries on success", async () => {
    vi.mocked(client.updateCalendarItem).mockResolvedValueOnce({ ok: true })
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries")

    const { result } = renderHook(() => useCalendarMutation("cal1"), { wrapper })

    act(() => result.current.updateDate("2024-03-15"))

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["calendar-item", "cal1"] })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["calendar"] })
    })
  })
})
