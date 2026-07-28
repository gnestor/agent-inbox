import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { ThemeProvider } from "@hammies/frontend"
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client"
import type { PersistedClient } from "@tanstack/query-persist-client-core"
import { TranscriptHostProvider } from "@hammies/frontend/components/session"
import { useInboxTranscriptHost } from "@/components/session/transcriptHost"
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister"
import { get, set, del } from "idb-keyval"
import { queryClient } from "@/lib/queryClient"
import { isTransientQuery } from "@/lib/query-persistence"
import { initCrashTelemetry } from "@/lib/crash-telemetry"
import { App } from "./App"
import "./index.css"

const EMPTY_PERSISTED_CLIENT: PersistedClient = {
  timestamp: 0,
  buster: "",
  clientState: { mutations: [], queries: [] },
}

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
      try {
        return await get<string>(key)
      } catch {
        await del(key).catch((err: unknown) => console.warn("[cache] Failed to clear corrupted cache entry:", err))
        return null
      }
    },
    setItem: set,
    removeItem: del,
  },
  key: "INBOX_QUERY_CACHE_V3",
  deserialize: (cached: string): PersistedClient => {
    try {
      const parsed: unknown = JSON.parse(cached)
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return EMPTY_PERSISTED_CLIENT
      const client = parsed as PersistedClient
      if (Array.isArray(client.clientState?.queries)) {
        client.clientState.queries = client.clientState.queries.filter(
          (query) =>
            !isTransientQuery(query.state.status ?? "", [...query.queryKey], query.state.data),
        )
      }
      return client
    } catch {
      return EMPTY_PERSISTED_CLIENT
    }
  },
})

/**
 * Supplies the shared session transcript with inbox's capabilities (artifact
 * rendering, run-file URLs, and the structured text-block panels). Mounted once
 * at the root — the transcript reads it through context on every row, so the
 * host must not be rebuilt per render; `useInboxTranscriptHost` memoizes it.
 *
 * Sits INSIDE the query provider because the panel-schema registry it needs is
 * fetched with react-query.
 */
function TranscriptHost({ children }: { children: React.ReactNode }) {
  return <TranscriptHostProvider host={useInboxTranscriptHost()}>{children}</TranscriptHostProvider>
}

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
          <TranscriptHost>
            <App />
          </TranscriptHost>
        </PersistQueryClientProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
