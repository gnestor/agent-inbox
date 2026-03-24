import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { ThemeProvider } from "@hammies/frontend"
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client"
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister"
import { get, set, del } from "idb-keyval"
import { queryClient } from "@/lib/queryClient"
import { App } from "./App"
import "./index.css"

// Migration: clear V1 cache key (safe to remove after all users have migrated)
del("INBOX_QUERY_CACHE").catch(() => {})

const CACHE_KEY = "INBOX_QUERY_CACHE_V2"

const persister = createAsyncStoragePersister({
  storage: {
    getItem: async (key: string) => {
      try {
        return await get(key)
      } catch {
        // Corrupted IndexedDB — nuke and start fresh
        await del(key).catch(() => {})
        return null
      }
    },
    setItem: set,
    removeItem: del,
  },
  key: CACHE_KEY,
  // If deserialize fails (corrupted/schema-mismatched cache), discard and refetch
  deserialize: (cached) => {
    try {
      const parsed = typeof cached === "string" ? JSON.parse(cached) : cached
      // Strip any infinite queries that leaked into the cache (fragile pages/pageParams state)
      if (parsed?.clientState?.queries) {
        parsed.clientState.queries = parsed.clientState.queries.filter(
          (q: { state?: { data?: unknown } }) => {
            const data = q.state?.data as Record<string, unknown> | undefined
            if (data && "pages" in data) return false
            return true
          },
        )
      }
      return parsed
    } catch {
      del(CACHE_KEY).catch(() => {})
      return { timestamp: 0, buster: "", clientState: { mutations: [], queries: [] } }
    }
  },
})

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider defaultTheme="system" storageKey="inbox-theme">
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{
            persister,
            dehydrateOptions: {
              shouldDehydrateQuery: (query) => {
                // Never persist plugin manifests (always refetch) or errored queries
                if (query.queryKey[0] === "plugins" || query.state.status === "error") return false
                // Never persist infinite queries — their pages/pageParams state is fragile
                // across restarts and causes crashes in TanStack Query's internal hasNextPage
                const data = query.state.data as Record<string, unknown> | undefined
                if (data && "pages" in data) return false
                return true
              },
            },
          }}
          // After IndexedDB cache is restored, refetch all active queries so
          // components get fresh data (invalidate alone won't refetch with staleTime: Infinity).
          onSuccess={() => queryClient.refetchQueries()}
        >
          <App />
        </PersistQueryClientProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
