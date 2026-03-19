import { useState, useEffect, useCallback, createContext, useContext } from "react"
import { getAuthSession, logout as apiLogout } from "@/api/client"
import type { UserProfile } from "@/types"

interface UserContextValue {
  user: UserProfile | null
  loading: boolean
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

export const UserContext = createContext<UserContextValue>({
  user: null,
  loading: true,
  logout: async () => {},
  refresh: async () => {},
})

export function useUserProvider() {
  const [user, setUser] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    let attempts = 0
    while (attempts < 3) {
      try {
        const { user } = await getAuthSession()
        setUser(user)
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
    setLoading(false)
  }, [])

  const logout = useCallback(async () => {
    await apiLogout()
    setUser(null)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { user, loading, logout, refresh }
}

export function useUser() {
  return useContext(UserContext)
}
