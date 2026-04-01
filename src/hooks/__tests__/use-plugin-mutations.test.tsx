// @vitest-environment jsdom
import React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { usePluginMutations } from "../use-plugin-mutations"
import * as client from "@/api/client"

vi.mock("@/api/client")
vi.mock("@/hooks/use-user", () => ({ useWorkspaceId: () => "ws1" }))
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

function makeWrapper(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

const PLUGIN_ID = "notion"
const ITEM_ID = "item-1"

describe("usePluginMutations", () => {
  let qc: QueryClient

  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    vi.resetAllMocks()
  })

  it("optimistically updates status in list and detail cache", async () => {
    // Seed caches
    qc.setQueryData(["plugin-items", "ws1", PLUGIN_ID, {}, undefined], {
      items: [{ id: ITEM_ID, status: "open", title: "Task 1" }],
    })
    qc.setQueryData(["plugin-item", "ws1", PLUGIN_ID, ITEM_ID], {
      id: ITEM_ID, status: "open", title: "Task 1",
    })

    vi.mocked(client.mutatePluginItem).mockResolvedValueOnce({ ok: true })

    const { result } = renderHook(() => usePluginMutations(PLUGIN_ID, ITEM_ID), {
      wrapper: makeWrapper(qc),
    })

    await act(() => result.current.mutate("update-status", { status: "done" }))

    // Check list cache was updated optimistically
    const listData = qc.getQueryData<any>(["plugin-items", "ws1", PLUGIN_ID, {}, undefined])
    expect(listData.items[0].status).toBe("done")

    // Check detail cache was updated optimistically
    const detailData = qc.getQueryData<any>(["plugin-item", "ws1", PLUGIN_ID, ITEM_ID])
    expect(detailData.status).toBe("done")
  })

  it("optimistically removes item from list on delete", async () => {
    qc.setQueryData(["plugin-items", "ws1", PLUGIN_ID, {}, undefined], {
      items: [
        { id: ITEM_ID, title: "Task 1" },
        { id: "item-2", title: "Task 2" },
      ],
    })

    vi.mocked(client.mutatePluginItem).mockResolvedValueOnce({ ok: true })

    const { result } = renderHook(() => usePluginMutations(PLUGIN_ID, ITEM_ID), {
      wrapper: makeWrapper(qc),
    })

    await act(() => result.current.mutate("delete", undefined))

    const listData = qc.getQueryData<any>(["plugin-items", "ws1", PLUGIN_ID, {}, undefined])
    expect(listData.items).toHaveLength(1)
    expect(listData.items[0].id).toBe("item-2")
  })

  it("rolls back on error", async () => {
    qc.setQueryData(["plugin-items", "ws1", PLUGIN_ID, {}, undefined], {
      items: [{ id: ITEM_ID, status: "open" }],
    })
    qc.setQueryData(["plugin-item", "ws1", PLUGIN_ID, ITEM_ID], {
      id: ITEM_ID, status: "open",
    })

    vi.mocked(client.mutatePluginItem).mockRejectedValueOnce(new Error("Server error"))

    const { result } = renderHook(() => usePluginMutations(PLUGIN_ID, ITEM_ID), {
      wrapper: makeWrapper(qc),
    })

    await act(() => result.current.mutate("update-status", { status: "done" }))

    // Should rollback to original values
    const listData = qc.getQueryData<any>(["plugin-items", "ws1", PLUGIN_ID, {}, undefined])
    expect(listData.items[0].status).toBe("open")

    const detailData = qc.getQueryData<any>(["plugin-item", "ws1", PLUGIN_ID, ITEM_ID])
    expect(detailData.status).toBe("open")
  })

  it("optimistically updates tags", async () => {
    qc.setQueryData(["plugin-item", "ws1", PLUGIN_ID, ITEM_ID], {
      id: ITEM_ID, tags: ["bug"],
    })

    vi.mocked(client.mutatePluginItem).mockResolvedValueOnce({ ok: true })

    const { result } = renderHook(() => usePluginMutations(PLUGIN_ID, ITEM_ID), {
      wrapper: makeWrapper(qc),
    })

    await act(() => result.current.mutate("update-tags", { tags: ["bug", "urgent"] }))

    const detailData = qc.getQueryData<any>(["plugin-item", "ws1", PLUGIN_ID, ITEM_ID])
    expect(detailData.tags).toEqual(["bug", "urgent"])
  })

  it("sets status to closed for archive action", async () => {
    qc.setQueryData(["plugin-item", "ws1", PLUGIN_ID, ITEM_ID], {
      id: ITEM_ID, status: "open",
    })

    vi.mocked(client.mutatePluginItem).mockResolvedValueOnce({ ok: true })

    const { result } = renderHook(() => usePluginMutations(PLUGIN_ID, ITEM_ID), {
      wrapper: makeWrapper(qc),
    })

    await act(() => result.current.mutate("archive", undefined))

    const detailData = qc.getQueryData<any>(["plugin-item", "ws1", PLUGIN_ID, ITEM_ID])
    expect(detailData.status).toBe("closed")
  })
})
