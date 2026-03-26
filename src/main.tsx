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
      // Migration guard: strip queries that old code persisted but shouldn't have.
      // Safe to remove once all users have reloaded with the updated shouldDehydrateQuery.
      if (parsed?.clientState?.queries) {
        parsed.clientState.queries = parsed.clientState.queries.filter(
          (q: { queryKey?: unknown[]; state?: { data?: unknown; status?: string } }) => {
            const key = q.queryKey?.[0]
            // Strip session lists (status changes frequently)
            if (key === "sessions") return false
            // Strip pending queries (Promise serializes to plain object, breaks restore)
            if (q.state?.status === "pending") return false
            // Strip infinite queries (fragile pages/pageParams state)
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
                const key = query.queryKey[0]
                // Never persist plugin manifests, errored, or pending queries.
                // Pending queries serialize a Promise that becomes a plain object on restore,
                // causing "promise.then is not a function" in persistQueryClientRestore.
                if (key === "plugins" || query.state.status === "error" || query.state.status === "pending") return false
                // Never persist session lists — status changes frequently (archive, complete)
                // and stale cached statuses cause UI inconsistencies
                if (key === "sessions") return false
                // Never persist infinite queries — their pages/pageParams state is fragile
                const data = query.state.data as Record<string, unknown> | undefined
                if (data && "pages" in data) return false
                return true
              },
            },
          }}
          // After IndexedDB cache is restored, refetch all active queries in the background
          onSuccess={() => queryClient.refetchQueries()}
        >
          <App />
        </PersistQueryClientProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
