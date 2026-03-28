// @vitest-environment jsdom
import React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor, act } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useUserProvider, useUser, UserContext } from "../use-user"
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

  it("starts loading and resolves with user", async () => {
    const mockUser = { name: "Alice", email: "alice@test.com", picture: "pic.jpg" }
    vi.mocked(client.getAuthSession).mockResolvedValueOnce(mockSessionResponse(mockUser))

    const { result } = renderHook(() => useUserProvider(), { wrapper: createWrapper() })

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.user).toEqual(mockUser)
    expect(result.current.workspaces).toHaveLength(1)
    expect(result.current.activeWorkspace?.id).toBe("ws1")
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
