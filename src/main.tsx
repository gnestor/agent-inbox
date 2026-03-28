import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { ThemeProvider } from "@hammies/frontend"
import { QueryClientProvider } from "@tanstack/react-query"
import { queryClient } from "@/lib/queryClient"
import { App } from "./App"
import "./index.css"

// API response caching is handled by src/lib/request.ts (memory + IndexedDB).
// TanStack Query persistence (PersistQueryClientProvider) removed — it blocked
// rendering during IndexedDB restoration and caused infinite query crashes.

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider defaultTheme="system" storageKey="inbox-theme">
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
