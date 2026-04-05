import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { ThemeProvider } from "@hammies/frontend"
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client"
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister"
import { get, set, del } from "idb-keyval"
import { queryClient } from "@/lib/queryClient"
import { WsStreamProvider } from "@/hooks/use-ws-stream"
import { App } from "./App"
import "./index.css"

// Register service worker for PWA standalone mode
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js")
}

/** Shared predicate: queries that should NOT be persisted to IndexedDB. */
function isTransientQuery(status: string, queryKey: readonly unknown[], data: unknown): boolean {
  if (status === "error" || status === "pending") return true
  if (queryKey[0] === "sessions") return true
  if (data && typeof data === "object" && "pages" in data) return true
  return false
}

const persister = createAsyncStoragePersister({
  storage: {
    getItem: async (key: string) => {
      try { return await get(key) } catch { await del(key).catch(() => {}); return null }
    },
    setItem: set,
    removeItem: del,
  },
  key: "INBOX_QUERY_CACHE_V2",
  deserialize: (cached) => {
    try {
      const parsed = typeof cached === "string" ? JSON.parse(cached) : cached
      if (parsed?.clientState?.queries) {
        parsed.clientState.queries = parsed.clientState.queries.filter(
          (q: { queryKey?: unknown[]; state?: { data?: unknown; status?: string } }) =>
            !isTransientQuery(q.state?.status ?? "", q.queryKey ?? [], q.state?.data),
        )
      }
      return parsed
    } catch {
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
              shouldDehydrateQuery: (query) =>
                !isTransientQuery(query.state.status, query.queryKey, query.state.data),
            },
          }}
        >
          <WsStreamProvider>
            <App />
          </WsStreamProvider>
        </PersistQueryClientProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
