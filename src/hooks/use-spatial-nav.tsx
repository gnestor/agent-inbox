import { createContext, useContext, useCallback, useRef, useEffect, useMemo } from "react"
import { useLocation, useNavigate } from "react-router-dom"

export type TabId = "inbox" | "tasks" | "sessions"
export const TAB_ORDER: TabId[] = ["inbox", "tasks", "sessions"]

interface TabState {
  selectedId?: string
  sessionOpen?: boolean
  sessionId?: string
}

type PersistedState = Record<TabId, TabState>

interface SpatialNavContextValue {
  activeTab: TabId
  tabIndex: number
  persistedState: PersistedState
  navigateToTab: (tab: TabId) => void
}

const SpatialNavContext = createContext<SpatialNavContextValue | null>(null)

function tabFromPathname(pathname: string): TabId {
  const first = pathname.split("/").filter(Boolean)[0]
  if (first === "tasks") return "tasks"
  if (first === "sessions") return "sessions"
  return "inbox"
}

export function tabStateFromPathname(pathname: string, tab: TabId): TabState {
  const parts = pathname.split("/").filter(Boolean)
  if (parts[0] !== tab) return {}

  const state: TabState = {}

  if (tab === "sessions") {
    if (parts[1]) state.selectedId = decodeURIComponent(parts[1])
    return state
  }

  // inbox or tasks
  if (parts[1]) {
    state.selectedId = decodeURIComponent(parts[1])
    if (parts[2] === "session") {
      state.sessionOpen = true
      state.sessionId = parts[3] !== "new" ? parts[3] : undefined
    }
  }
  return state
}

function buildUrl(tab: TabId, state: TabState): string {
  const base = `/${tab}`
  if (!state.selectedId) return base

  let url = `${base}/${encodeURIComponent(state.selectedId)}`
  if (state.sessionOpen) {
    url += `/session/${state.sessionId ?? "new"}`
  }
  return url
}

export function SpatialNavProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()

  const activeTab = tabFromPathname(location.pathname)
  const tabIndex = TAB_ORDER.indexOf(activeTab)
  const persistedRef = useRef<PersistedState>({
    inbox: {},
    tasks: {},
    sessions: {},
  })

  // Sync URL changes into persisted state for the active tab
  useEffect(() => {
    persistedRef.current[activeTab] = tabStateFromPathname(location.pathname, activeTab)
  }, [location.pathname, activeTab])

  const navigateToTab = useCallback(
    (tab: TabId) => {
      if (tab === activeTab) return
      const url = buildUrl(tab, persistedRef.current[tab])
      navigate(url)
    },
    [activeTab, navigate],
  )

  const value = useMemo(
    () => ({
      activeTab,
      tabIndex,
      persistedState: persistedRef.current,
      navigateToTab,
    }),
    [activeTab, tabIndex, navigateToTab],
  )

  return <SpatialNavContext.Provider value={value}>{children}</SpatialNavContext.Provider>
}

export function useSpatialNav() {
  const ctx = useContext(SpatialNavContext)
  if (!ctx) throw new Error("useSpatialNav must be used within SpatialNavProvider")
  return ctx
}
