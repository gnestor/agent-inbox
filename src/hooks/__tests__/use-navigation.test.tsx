// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { NavigationProvider } from "@/components/navigation/NavigationProvider"
import { useNavigation } from "../use-navigation"

// Mock storage
vi.mock("@/lib/navigation-storage", () => ({
  saveNavigationState: vi.fn(() => Promise.resolve()),
  loadNavigationState: vi.fn(() => Promise.resolve(null)),
  migrateFromLocalStorage: vi.fn(() => Promise.resolve(null)),
}))

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <MemoryRouter initialEntries={["/emails"]}>
      <NavigationProvider>{children}</NavigationProvider>
    </MemoryRouter>
  )
}

describe("useNavigation", () => {
  it("provides default state", () => {
    const { result } = renderHook(() => useNavigation(), { wrapper })
    expect(result.current.activeTab).toBe("emails")
    expect(result.current.getPanels()).toEqual([{ id: "list", type: "list", props: {} }])
  })

  it("selectItem pushes a detail panel", () => {
    const { result } = renderHook(() => useNavigation(), { wrapper })
    act(() => result.current.selectItem("abc123"))
    const panels = result.current.getPanels()
    expect(panels).toHaveLength(2)
    expect(panels[1]).toEqual({ id: "detail:abc123", type: "detail", props: { itemId: "abc123" } })
    expect(result.current.getSelectedItemId()).toBe("abc123")
  })

  it("selectItem replaces existing detail panel and clears subsequent panels", () => {
    const { result } = renderHook(() => useNavigation(), { wrapper })
    act(() => result.current.selectItem("item1"))
    act(() => result.current.pushPanel({ id: "session:s1", type: "session", props: { sessionId: "s1" } }))
    expect(result.current.getPanels()).toHaveLength(3)

    act(() => result.current.selectItem("item2"))
    const panels = result.current.getPanels()
    expect(panels).toHaveLength(2) // list + new detail (session removed)
    expect(panels[1].props).toEqual({ itemId: "item2" })
  })

  it("deselectItem removes detail and subsequent panels", () => {
    const { result } = renderHook(() => useNavigation(), { wrapper })
    act(() => result.current.selectItem("abc"))
    act(() => result.current.deselectItem())
    expect(result.current.getPanels()).toHaveLength(1) // list only
    expect(result.current.getSelectedItemId()).toBeUndefined()
  })

  it("pushPanel adds to the end", () => {
    const { result } = renderHook(() => useNavigation(), { wrapper })
    act(() => result.current.selectItem("abc"))
    act(() => result.current.pushPanel({ id: "session:s1", type: "session", props: { sessionId: "s1" } }))
    expect(result.current.getPanels()).toHaveLength(3)
    expect(result.current.getPanels()[2].type).toBe("session")
  })

  it("popPanel removes by id", () => {
    const { result } = renderHook(() => useNavigation(), { wrapper })
    act(() => result.current.selectItem("abc"))
    act(() => result.current.pushPanel({ id: "session:s1", type: "session", props: { sessionId: "s1" } }))
    act(() => result.current.popPanel("session:s1"))
    expect(result.current.getPanels()).toHaveLength(2) // list + detail
  })

  it("openSession pushes a session panel", () => {
    const { result } = renderHook(() => useNavigation(), { wrapper })
    act(() => result.current.selectItem("abc"))
    act(() => result.current.openSession("sess123"))
    const panels = result.current.getPanels()
    expect(panels).toHaveLength(3)
    expect(panels[2]).toEqual({ id: "session:sess123", type: "session", props: { sessionId: "sess123", linkedItemId: "abc" } })
  })

  it("openSession with undefined creates new session", () => {
    const { result } = renderHook(() => useNavigation(), { wrapper })
    act(() => result.current.selectItem("abc"))
    act(() => result.current.openSession())
    const panels = result.current.getPanels()
    expect(panels[2].props).toEqual({ sessionId: "new", linkedItemId: "abc" })
  })

  it("switchTab changes activeTab", () => {
    const { result } = renderHook(() => useNavigation(), { wrapper })
    act(() => result.current.switchTab("tasks"))
    expect(result.current.activeTab).toBe("tasks")
  })

  it("getSelectedItemId with tab arg persists across tab switch", () => {
    const { result } = renderHook(() => useNavigation(), { wrapper })
    act(() => result.current.selectItem("email123"))
    expect(result.current.getSelectedItemId("emails")).toBe("email123")

    act(() => result.current.switchTab("tasks"))
    // Tab-scoped: emails selection still available
    expect(result.current.getSelectedItemId("emails")).toBe("email123")
    // Default (active tab) returns tasks selection (undefined)
    expect(result.current.getSelectedItemId()).toBeUndefined()
  })

  it("selectItem with listIndex computes direction in state", () => {
    const { result } = renderHook(() => useNavigation(), { wrapper })
    act(() => result.current.selectItem("item1", 3))
    expect(result.current.getItemDirection()).toBe(1) // 3 > 0 (default prev)

    act(() => result.current.selectItem("item2", 1))
    expect(result.current.getItemDirection()).toBe(-1) // 1 < 3
  })

  it("switchTab + selectItem in same act puts item on correct tab", () => {
    const { result } = renderHook(() => useNavigation(), { wrapper })
    // Start on emails, switch to sessions and select an item in one batch
    act(() => {
      result.current.switchTab("sessions")
      result.current.selectItem("session-uuid")
    })
    expect(result.current.activeTab).toBe("sessions")
    expect(result.current.getSelectedItemId("sessions")).toBe("session-uuid")
    // The item should NOT appear on the emails tab
    expect(result.current.getSelectedItemId("emails")).toBeUndefined()
  })

  it("openNewSession places new_session panel at position 1", () => {
    const { result } = renderHook(() => useNavigation(), { wrapper })
    act(() => result.current.openNewSession())
    const panels = result.current.getPanels()
    expect(panels).toHaveLength(2)
    expect(panels[1]).toEqual({ id: "new_session", type: "new_session", props: {} })
  })

  it("openNewSession clears selectedItemId", () => {
    const { result } = renderHook(() => useNavigation(), { wrapper })
    act(() => result.current.selectItem("item-1"))
    expect(result.current.getSelectedItemId()).toBe("item-1")
    act(() => result.current.openNewSession())
    expect(result.current.getSelectedItemId()).toBeUndefined()
  })

  it("openNewSession replaces existing detail panel at position 1", () => {
    const { result } = renderHook(() => useNavigation(), { wrapper })
    act(() => result.current.selectItem("item-1"))
    expect(result.current.getPanels()).toHaveLength(2)
    act(() => result.current.openNewSession())
    const panels = result.current.getPanels()
    expect(panels).toHaveLength(2)
    expect(panels[1].type).toBe("new_session")
  })

  it("popPanel('new_session') removes the new_session panel", () => {
    const { result } = renderHook(() => useNavigation(), { wrapper })
    act(() => result.current.openNewSession())
    act(() => result.current.popPanel("new_session"))
    expect(result.current.getPanels()).toHaveLength(1) // list only
  })

  it("replacePanel swaps new_session with a session panel after creation", () => {
    const { result } = renderHook(() => useNavigation(), { wrapper })
    act(() => result.current.openNewSession())
    act(() =>
      result.current.replacePanel("new_session", {
        id: "session:abc",
        type: "session",
        props: { sessionId: "abc" },
      }),
    )
    const panels = result.current.getPanels()
    expect(panels).toHaveLength(2)
    expect(panels[1]).toEqual({
      id: "session:abc",
      type: "session",
      props: { sessionId: "abc" },
    })
  })
})
