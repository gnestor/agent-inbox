import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { ThemeProvider } from "@hammies/frontend"
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client"
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister"
import { get, set, del } from "idb-keyval"
import { queryClient } from "@/lib/queryClient"
import { isTransientQuery } from "@/lib/query-persistence"
import { initCrashTelemetry } from "@/lib/crash-telemetry"
import { App } from "./App"
import "./index.css"

// Start heartbeat + crash-detection telemetry as early as possible so we
// capture pre-crash state even if app boot fails. Safe to call before render.
initCrashTelemetry()

// Register service worker for PWA standalone mode
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js")
}

const persister = createAsyncStoragePersister({
  storage: {
    getItem: async (key: string) => {
      try { return await get(key) } catch { await del(key).catch((err) => console.warn("[cache] Failed to clear corrupted cache entry:", err)); return null }
    },
    setItem: set,
    removeItem: del,
  },
  key: "INBOX_QUERY_CACHE_V3",
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
            buster: __APP_VERSION__,
            dehydrateOptions: {
              shouldDehydrateQuery: (query) =>
                !isTransientQuery(query.state.status, query.queryKey, query.state.data),
            },
          }}
        >
          <App />
        </PersistQueryClientProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
