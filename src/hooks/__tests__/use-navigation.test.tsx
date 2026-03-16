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
})
