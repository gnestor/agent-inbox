import { useEffect, useRef } from "react"
import { toast } from "sonner"
import { useWsUiState, useWsConnectionStore } from "@/stores/ws-connection-store"

// Surface the WebSocket connection state as a sonner toast. Persistent while
// reconnecting / offline / error, auto-dismissed on reconnect. Uses a stable
// toast id so repeated dismiss/show calls don't stack up.

const TOAST_ID = "ws-connection"

export function SessionConnectionSurface() {
  const uiState = useWsUiState()
  const status = useWsConnectionStore((s) => s.status)
  const prev = useRef(uiState)

  useEffect(() => {
    if (uiState === "connected") {
      if (prev.current !== "connected" && prev.current !== "connecting") {
        // Transitioned from a bad state back to connected — show a brief
        // success and dismiss the persistent toast.
        toast.success("Reconnected", { id: TOAST_ID, duration: 2_000 })
      } else {
        // Just came up cleanly or we were already up. No toast needed.
        toast.dismiss(TOAST_ID)
      }
    } else if (uiState === "connecting") {
      // Initial connect — don't nag users with a toast on first load.
      toast.dismiss(TOAST_ID)
    } else if (uiState === "offline") {
      toast.warning("Offline — reconnecting when back online", {
        id: TOAST_ID,
        duration: Infinity,
      })
    } else if (uiState === "reconnecting") {
      toast.warning("Connection lost — reconnecting...", {
        id: TOAST_ID,
        duration: Infinity,
        description: status.nextRetryAt
          ? `Next retry at ${new Date(status.nextRetryAt).toLocaleTimeString()}`
          : undefined,
      })
    } else if (uiState === "error") {
      toast.error("Failed to connect to server", {
        id: TOAST_ID,
        duration: Infinity,
      })
    }
    prev.current = uiState
  }, [uiState, status.nextRetryAt])

  return null
}
