import { createContext, useContext, useCallback, useRef, useEffect, useMemo } from "react"
import { useLocation, useNavigate } from "react-router-dom"

export type TabId = "emails" | "tasks" | "sessions"
export const TAB_ORDER: TabId[] = ["emails", "tasks", "sessions"]

interface TabState {
  selectedId?: string
  sessionOpen?: boolean
  sessionId?: string
}

type PersistedState = Record<TabId, TabState>

// --- localStorage persistence ---
const STORAGE_KEY = "spatial-nav-state"

interface SavedNavState {
  pathname: string
  tabs: PersistedState
  itemSessions: Array<[string, { sessionOpen: boolean; sessionId?: string }]>
}

function migrateNavState(state: SavedNavState): SavedNavState {
  const tabs = state.tabs as Record<string, TabState>
  if ("inbox" in tabs && !("emails" in tabs)) {
    tabs.emails = tabs.inbox
    delete tabs.inbox
  }
  if (state.pathname?.startsWith("/inbox")) {
    state.pathname = state.pathname.replace(/^\/inbox/, "/emails")
  }
  state.itemSessions = (state.itemSessions ?? []).map(([key, val]) => [
    key.replace(/^inbox:/, "emails:"),
    val,
  ])
  return state
}

function loadNavState(): SavedNavState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? migrateNavState(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

function saveNavState(state: SavedNavState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* ignore */
  }
}

/** Read the saved pathname for initial redirect (called outside React) */
export function getSavedPathname(): string {
  const saved = loadNavState()
  return saved?.pathname ?? "/emails"
}

interface SpatialNavContextValue {
  activeTab: TabId
  persistedState: PersistedState
  navigateToTab: (tab: TabId) => void
  getItemState: (
    tab: TabId,
    itemId: string,
  ) => { sessionOpen: boolean; sessionId?: string } | undefined
}

const SpatialNavContext = createContext<SpatialNavContextValue | null>(null)

function tabFromPathname(pathname: string): TabId {
  const first = pathname.split("/").filter(Boolean)[0]
  if (first === "tasks") return "tasks"
  if (first === "sessions") return "sessions"
  return "emails"
}

export function tabStateFromPathname(pathname: string, tab: TabId): TabState {
  const parts = pathname.split("/").filter(Boolean)
  if (parts[0] !== tab) return {}

  const state: TabState = {}

  if (tab === "sessions") {
    if (parts[1]) state.selectedId = decodeURIComponent(parts[1])
    return state
  }

  // emails or tasks
  if (parts[1]) {
    state.selectedId = decodeURIComponent(parts[1])
    if (parts[2] === "session") {
      state.sessionOpen = true
      state.sessionId = parts[3] !== "new" ? parts[3] : undefined
    }
  }
  return state
}

export function buildUrl(tab: TabId, state: TabState): string {
  const base = `/${tab}`
  if (!state.selectedId) return base

  let url = `${base}/${encodeURIComponent(state.selectedId)}`
  if (state.sessionOpen) {
    url += `/session/${state.sessionId ?? "new"}`
  }
  return url
}

export function SpatialNavProvider({
  children,
  isMobile = false,
}: {
  children: React.ReactNode
  isMobile?: boolean
}) {
  const location = useLocation()
  const navigate = useNavigate()

  const activeTab = tabFromPathname(location.pathname)
  const isFromSidebar = !!(location.state as { fromSidebar?: boolean } | null)?.fromSidebar
  // Ref so navigateToTab can read the latest value without re-creating the callback
  const isFromSidebarRef = useRef(isFromSidebar)
  isFromSidebarRef.current = isFromSidebar

  // Load saved state on first render
  const saved = useRef(loadNavState())
  const persistedRef = useRef<PersistedState>(
    saved.current?.tabs ?? { emails: {}, tasks: {}, sessions: {} },
  )
  // Per-item session state: key is "tab:itemId", value is session open/id
  const itemSessionRef = useRef<Map<string, { sessionOpen: boolean; sessionId?: string }>>(
    new Map(saved.current?.itemSessions ?? []),
  )

  // Sync URL changes into persisted state for the active tab
  // Save/restore per-item session state
  useEffect(() => {
    // Sidebar-originated views should not update tab state or persisted pathname —
    // so clicking a tab still returns to the last real navigation for that tab.
    if (isFromSidebar) return

    const newState = tabStateFromPathname(location.pathname, activeTab)
    const oldState = persistedRef.current[activeTab]

    if (
      activeTab !== "sessions" &&
      oldState.selectedId &&
      oldState.selectedId !== newState.selectedId
    ) {
      // Save outgoing item's session state
      itemSessionRef.current.set(`${activeTab}:${oldState.selectedId}`, {
        sessionOpen: oldState.sessionOpen ?? false,
        sessionId: oldState.sessionId,
      })
    }

    // Same item, explicit session state change (open/close) — update the Map
    if (
      activeTab !== "sessions" &&
      newState.selectedId &&
      newState.selectedId === oldState.selectedId
    ) {
      itemSessionRef.current.set(`${activeTab}:${newState.selectedId}`, {
        sessionOpen: newState.sessionOpen ?? false,
        sessionId: newState.sessionId,
      })
    }

    // Restore session state when navigating to an item that had a session open.
    // Skipped on mobile — users open sessions manually from the detail view.
    if (
      !isMobile &&
      activeTab !== "sessions" &&
      newState.selectedId &&
      newState.selectedId !== oldState.selectedId &&
      !newState.sessionOpen
    ) {
      const saved = itemSessionRef.current.get(`${activeTab}:${newState.selectedId}`)
      if (saved?.sessionOpen) {
        persistedRef.current[activeTab] = {
          ...newState,
          sessionOpen: true,
          sessionId: saved.sessionId,
        }
        navigate(buildUrl(activeTab, persistedRef.current[activeTab]), { replace: true })
        return
      }
    }

    persistedRef.current[activeTab] = newState

    // Persist to localStorage
    saveNavState({
      pathname: location.pathname,
      tabs: { ...persistedRef.current },
      itemSessions: [...itemSessionRef.current.entries()],
    })
  }, [location.pathname, isFromSidebar, activeTab, navigate, isMobile])

  const navigateToTab = useCallback(
    (tab: TabId) => {
      // When currently on a sidebar-originated view, always navigate — don't treat it
      // as "already on that tab".
      if (tab === activeTab && !isFromSidebarRef.current) return
      const url = buildUrl(tab, persistedRef.current[tab])
      navigate(url)
    },
    [activeTab, navigate],
  )

  const getItemState = useCallback(
    (tab: TabId, itemId: string) => itemSessionRef.current.get(`${tab}:${itemId}`),
    [],
  )

  const value = useMemo(
    () => ({
      activeTab,
      persistedState: persistedRef.current,
      navigateToTab,
      getItemState,
    }),
    [activeTab, navigateToTab, getItemState],
  )

  return <SpatialNavContext.Provider value={value}>{children}</SpatialNavContext.Provider>
}

export function useSpatialNav() {
  const ctx = useContext(SpatialNavContext)
  if (!ctx) throw new Error("useSpatialNav must be used within SpatialNavProvider")
  return ctx
}
