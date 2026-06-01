// @vitest-environment jsdom
import React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor, act } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useUserProvider, useUser, useWorkspaceId, UserContext } from "../use-user"
import * as client from "@/api/client"

vi.mock("@/api/client")

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

const mockSessionResponse = (user: { name: string; email: string; picture?: string } | null) => ({
  user,
  workspaces: user ? [{ id: "ws1", name: "Workspace 1", role: "admin" as const }] : [],
  activeWorkspace: user ? { id: "ws1", name: "Workspace 1", role: "admin" as const } : null,
})

describe("useUserProvider", () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it("Scenario: `useUserProvider` populates the context once on mount — starts loading, resolves user/workspaces/activeWorkspace, derives isAdmin", async () => {
    const mockUser = { name: "Alice", email: "alice@test.com", picture: "pic.jpg" }
    vi.mocked(client.getAuthSession).mockResolvedValueOnce(mockSessionResponse(mockUser))

    const { result } = renderHook(() => useUserProvider(), { wrapper: createWrapper() })

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.user).toEqual(mockUser)
    expect(result.current.workspaces).toHaveLength(1)
    expect(result.current.activeWorkspace?.id).toBe("ws1")
    // isAdmin derived from the active workspace role.
    expect(result.current.isAdmin).toBe(true)
    // getAuthSession is called exactly once on mount.
    expect(client.getAuthSession).toHaveBeenCalledTimes(1)
  })

  it("sets user to null on auth error", async () => {
    vi.mocked(client.getAuthSession).mockRejectedValueOnce(new Error("Unauthorized"))

    const { result } = renderHook(() => useUserProvider(), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.user).toBeNull()
    expect(result.current.workspaces).toHaveLength(0)
  })

  it("logout clears user and calls API", async () => {
    const mockUser = { name: "Alice", email: "alice@test.com" }
    vi.mocked(client.getAuthSession).mockResolvedValueOnce(mockSessionResponse(mockUser))
    vi.mocked(client.logout).mockResolvedValueOnce({ ok: true })

    const { result } = renderHook(() => useUserProvider(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.user).toEqual(mockUser))

    await act(async () => {
      await result.current.logout()
    })

    expect(client.logout).toHaveBeenCalledOnce()
    expect(result.current.user).toBeNull()
  })

  it("refresh re-fetches session", async () => {
    const user1 = { name: "Alice", email: "alice@test.com" }
    const user2 = { name: "Alice Updated", email: "alice@test.com" }
    vi.mocked(client.getAuthSession)
      .mockResolvedValueOnce(mockSessionResponse(user1))
      .mockResolvedValueOnce(mockSessionResponse(user2))

    const { result } = renderHook(() => useUserProvider(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.user).toEqual(user1))

    await act(async () => {
      await result.current.refresh()
    })

    expect(result.current.user).toEqual(user2)
    expect(client.getAuthSession).toHaveBeenCalledTimes(2)
  })

  it("Scenario: Network errors during refresh retry up to 3× with backoff — retries a TypeError then succeeds; non-TypeError breaks immediately", async () => {
    vi.useFakeTimers()
    try {
      const mockUser = { name: "Alice", email: "alice@test.com" }
      // First two attempts throw a network TypeError, third resolves.
      vi.mocked(client.getAuthSession)
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValueOnce(mockSessionResponse(mockUser))

      const { result } = renderHook(() => useUserProvider(), { wrapper: createWrapper() })

      // Drain the 1.5s × attempt backoff delays between retries.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500 + 3000)
      })

      expect(client.getAuthSession).toHaveBeenCalledTimes(3)
      expect(result.current.user).toEqual(mockUser)
      expect(result.current.loading).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it("Scenario: `switchWorkspace` invalidates all queries before refresh — setActiveWorkspace, then invalidateQueries, then refresh", async () => {
    const user = { name: "Alice", email: "alice@test.com" }
    vi.mocked(client.getAuthSession).mockResolvedValue(mockSessionResponse(user))
    vi.mocked(client.setActiveWorkspace).mockResolvedValue({ ok: true } as never)

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries")
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(() => useUserProvider(), { wrapper })
    await waitFor(() => expect(result.current.user).toEqual(user))

    await act(async () => {
      await result.current.switchWorkspace("ws2")
    })

    expect(client.setActiveWorkspace).toHaveBeenCalledWith("ws2")
    expect(invalidateSpy).toHaveBeenCalled()
    // Ordering: setActiveWorkspace before invalidateQueries.
    const setOrder = vi.mocked(client.setActiveWorkspace).mock.invocationCallOrder[0]!
    const invOrder = invalidateSpy.mock.invocationCallOrder[0]!
    expect(setOrder).toBeLessThan(invOrder)
  })

  it("Scenario: `session-expired` event triggers re-login — refresh runs and sets user null when the JWT is gone", async () => {
    const user = { name: "Alice", email: "alice@test.com" }
    vi.mocked(client.getAuthSession)
      .mockResolvedValueOnce(mockSessionResponse(user)) // initial mount
      .mockResolvedValueOnce(mockSessionResponse(null)) // after expiry

    const { result } = renderHook(() => useUserProvider(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.user).toEqual(user))

    await act(async () => {
      window.dispatchEvent(new Event("session-expired"))
    })

    await waitFor(() => expect(result.current.user).toBeNull())
    expect(client.getAuthSession).toHaveBeenCalledTimes(2)
  })
})

describe("useWorkspaceId", () => {
  it("Scenario: `useWorkspaceId()` returns a stable empty string when no workspace — id when present, '' when absent", () => {
    const withWs = {
      user: { name: "Bob", email: "bob@test.com" },
      loading: false,
      logout: async () => {},
      refresh: async () => {},
      activeWorkspace: { id: "ws9", name: "Nine", role: "member" as const },
      workspaces: [],
      switchWorkspace: async () => {},
      isAdmin: false,
    }
    const wrapper = (value: typeof withWs) => ({ children }: { children: React.ReactNode }) => (
      <UserContext.Provider value={value}>{children}</UserContext.Provider>
    )

    const present = renderHook(() => useWorkspaceId(), { wrapper: wrapper(withWs) })
    expect(present.result.current).toBe("ws9")

    const absent = renderHook(() => useWorkspaceId(), {
      wrapper: wrapper({ ...withWs, activeWorkspace: null }),
    })
    expect(absent.result.current).toBe("")
  })
})

describe("useUser", () => {
  it("returns context value from provider", () => {
    const contextValue = {
      user: { name: "Bob", email: "bob@test.com" },
      loading: false,
      logout: async () => {},
      refresh: async () => {},
      activeWorkspace: { id: "ws1", name: "Test", role: "admin" as const },
      workspaces: [{ id: "ws1", name: "Test", role: "admin" as const }],
      switchWorkspace: async () => {},
      isAdmin: true,
    }

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <UserContext.Provider value={contextValue}>{children}</UserContext.Provider>
    )

    const { result } = renderHook(() => useUser(), { wrapper })
    expect(result.current.user).toEqual(contextValue.user)
    expect(result.current.loading).toBe(false)
    expect(result.current.isAdmin).toBe(true)
  })
})
