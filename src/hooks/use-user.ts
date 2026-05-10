import { useState, useEffect, useCallback, createContext, useContext } from "react"
import { getAuthSession, logout as apiLogout, setActiveWorkspace } from "@/api/client"
import type { UserProfile, Workspace } from "@/types"
import { useQueryClient } from "@tanstack/react-query"

interface UserContextValue {
  user: UserProfile | null
  loading: boolean
  logout: () => Promise<void>
  refresh: () => Promise<void>
  activeWorkspace: Workspace | null
  workspaces: Workspace[]
  switchWorkspace: (workspaceId: string) => Promise<void>
  isAdmin: boolean
}

export const UserContext = createContext<UserContextValue>({
  user: null,
  loading: true,
  logout: async () => {},
  refresh: async () => {},
  activeWorkspace: null,
  workspaces: [],
  switchWorkspace: async () => {},
  isAdmin: false,
})

export function useUserProvider() {
  const [user, setUser] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeWorkspace, setActiveWorkspaceState] = useState<Workspace | null>(null)
  const queryClient = useQueryClient()

  const refresh = useCallback(async () => {
    let attempts = 0
    while (attempts < 3) {
      try {
        const result = await getAuthSession()
        setUser(result.user)
        setWorkspaces(result.workspaces || [])
        setActiveWorkspaceState(result.activeWorkspace || null)
        setLoading(false)
        return
      } catch (err) {
        // Network error (server restarting) — retry with backoff
        if (err instanceof TypeError && attempts < 2) {
          attempts++
          await new Promise((r) => setTimeout(r, 1500 * attempts))
          continue
        }
        break
      }
    }
    setUser(null)
    setWorkspaces([])
    setActiveWorkspaceState(null)
    setLoading(false)
  }, [])

  const logout = useCallback(async () => {
    await apiLogout()
    setUser(null)
    setWorkspaces([])
    setActiveWorkspaceState(null)
  }, [])

  const switchWorkspace = useCallback(async (workspaceId: string) => {
    await setActiveWorkspace(workspaceId)
    // Invalidate all queries so data reloads for new workspace
    queryClient.invalidateQueries()
    // Refresh to update workspace state
    await refresh()
  }, [queryClient, refresh])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    const handle = () => refresh()
    window.addEventListener("session-expired", handle)
    return () => window.removeEventListener("session-expired", handle)
  }, [refresh])

  const isAdmin = activeWorkspace?.role === "admin"

  return { user, loading, logout, refresh, activeWorkspace, workspaces, switchWorkspace, isAdmin }
}

export function useUser() {
  return useContext(UserContext)
}

/** Returns the active workspace ID (stable string for use in query keys). */
export function useWorkspaceId(): string {
  return useContext(UserContext).activeWorkspace?.id ?? ""
}
