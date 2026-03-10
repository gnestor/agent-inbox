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

const persister = createAsyncStoragePersister({
  storage: { getItem: get, setItem: set, removeItem: del },
  key: "INBOX_QUERY_CACHE",
})

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider defaultTheme="system" storageKey="inbox-theme">
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{ persister }}
          // After IndexedDB cache is restored, invalidate all queries so active
          // components refetch fresh data in the background on page load.
          onSuccess={() => queryClient.invalidateQueries()}
        >
          <App />
        </PersistQueryClientProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
