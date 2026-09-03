// WebSocket connection state — single source of truth for the UI's view of
// connectivity. Updates happen only through the pure action functions below.
//
// Ported from pingdotgg/t3code/apps/web/src/rpc/wsConnectionState.ts, adapted
// for Zustand. Backoff parameters and the UI state taxonomy are identical to
// t3code's.

import { create } from "zustand"
import { backoffDelayMs } from "@hammies/contracts/retry"

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

export const WS_RECONNECT_INITIAL_DELAY_MS = 1_000
export const WS_RECONNECT_BACKOFF_FACTOR = 2
export const WS_RECONNECT_MAX_DELAY_MS = 64_000
export const WS_RECONNECT_MAX_RETRIES = 7
export const WS_RECONNECT_MAX_ATTEMPTS = WS_RECONNECT_MAX_RETRIES + 1

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WsPhase = "idle" | "connecting" | "connected" | "disconnected"
export type WsReconnectPhase = "idle" | "attempting" | "waiting" | "exhausted"
export type WsUiState = "connected" | "connecting" | "reconnecting" | "offline" | "error" | "exhausted"

export interface WsConnectionStatus {
  readonly phase: WsPhase
  readonly reconnectPhase: WsReconnectPhase
  readonly attemptCount: number
  readonly reconnectAttemptCount: number
  readonly reconnectMaxAttempts: number
  readonly connectedAt: string | null
  readonly disconnectedAt: string | null
  readonly nextRetryAt: string | null
  readonly online: boolean
  readonly hasConnected: boolean
  readonly lastError: string | null
  readonly lastErrorAt: string | null
  readonly closeCode: number | null
  readonly closeReason: string | null
}

export const INITIAL_WS_CONNECTION_STATUS: WsConnectionStatus = Object.freeze({
  phase: "idle",
  reconnectPhase: "idle",
  attemptCount: 0,
  reconnectAttemptCount: 0,
  reconnectMaxAttempts: WS_RECONNECT_MAX_ATTEMPTS,
  connectedAt: null,
  disconnectedAt: null,
  nextRetryAt: null,
  online: typeof navigator === "undefined" ? true : navigator.onLine !== false,
  hasConnected: false,
  lastError: null,
  lastErrorAt: null,
  closeCode: null,
  closeReason: null,
})

interface WsConnectionStore {
  status: WsConnectionStatus
  recordAttempt(): void
  recordOpened(): void
  recordErrored(message?: string | null): void
  recordClosed(details?: { code?: number; reason?: string }): void
  setOnline(online: boolean): void
  reset(): void
}

// ---------------------------------------------------------------------------
// Pure state updaters
// ---------------------------------------------------------------------------

const isoNow = () => new Date().toISOString()

/**
 * The delay before retry `retryIndex` (0-based). Backed by the shared
 * `backoffDelayMs` from `@hammies/contracts/retry` — `attempt` there is
 * 1-based, so this passes `retryIndex + 1`. Defaults to `backoffDelayMs`'s
 * own full-jitter behavior; pass `identity` for the exact, unjittered value
 * (what deterministic tests want). Returns `null` once `retryIndex` reaches
 * `WS_RECONNECT_MAX_RETRIES` — the caller's signal to stop scheduling
 * reconnects and treat the connection as exhausted.
 */
export function getWsReconnectDelayMsForRetry(
  retryIndex: number,
  jitter?: (delayMs: number) => number,
): number | null {
  if (!Number.isInteger(retryIndex) || retryIndex < 0 || retryIndex >= WS_RECONNECT_MAX_RETRIES) {
    return null
  }
  return backoffDelayMs(retryIndex + 1, {
    baseMs: WS_RECONNECT_INITIAL_DELAY_MS,
    capMs: WS_RECONNECT_MAX_DELAY_MS,
    factor: WS_RECONNECT_BACKOFF_FACTOR,
    ...(jitter ? { jitter } : {}),
  })
}

export function applyAttempt(current: WsConnectionStatus): WsConnectionStatus {
  return {
    ...current,
    phase: "connecting",
    reconnectPhase: "attempting",
    attemptCount: current.attemptCount + 1,
    reconnectAttemptCount:
      current.phase === "connected" ? 1 : current.reconnectAttemptCount + 1,
    nextRetryAt: null,
  }
}

export function applyOpened(current: WsConnectionStatus): WsConnectionStatus {
  return {
    ...current,
    phase: "connected",
    reconnectPhase: "idle",
    connectedAt: isoNow(),
    disconnectedAt: null,
    hasConnected: true,
    reconnectAttemptCount: 0,
    nextRetryAt: null,
    closeCode: null,
    closeReason: null,
  }
}

/**
 * The retry index for the NEXT reconnect, given how many connect() attempts
 * have happened since the last successful open (0 right after an open that
 * later dropped — that first post-drop disconnect is still retry index 0).
 * Used by `applyDisconnect` to compute the store's `nextRetryAt` — the ONLY
 * place a delay is drawn, since `getWsReconnectDelayMsForRetry` jitters
 * randomly and `use-ws-stream.tsx` schedules its actual reconnect timer off
 * `nextRetryAt` rather than recomputing (a second independent draw would
 * disagree with what the UI displays). Exported for direct unit coverage.
 */
export function nextRetryIndex(reconnectAttemptCount: number): number {
  return Math.max(0, reconnectAttemptCount - 1)
}

function applyDisconnect(
  current: WsConnectionStatus,
  updates: Partial<
    Pick<WsConnectionStatus, "closeCode" | "closeReason" | "lastError" | "lastErrorAt">
  >,
): WsConnectionStatus {
  const disconnectedAt = current.disconnectedAt ?? isoNow()
  const nextDelayMs =
    current.nextRetryAt !== null || current.reconnectPhase === "exhausted"
      ? null
      : getWsReconnectDelayMsForRetry(nextRetryIndex(current.reconnectAttemptCount))
  const nextRetryAt =
    nextDelayMs === null
      ? current.nextRetryAt
      : new Date(Date.now() + nextDelayMs).toISOString()
  const reconnectPhase: WsReconnectPhase =
    current.reconnectPhase === "waiting" || current.reconnectPhase === "exhausted"
      ? current.reconnectPhase
      : nextDelayMs === null
        ? "exhausted"
        : "waiting"
  return {
    ...current,
    ...updates,
    disconnectedAt,
    nextRetryAt,
    phase: "disconnected",
    reconnectPhase,
  }
}

export function applyErrored(
  current: WsConnectionStatus,
  message?: string | null,
): WsConnectionStatus {
  return applyDisconnect(current, {
    lastError: message?.trim() ? message : current.lastError,
    lastErrorAt: isoNow(),
  })
}

export function applyClosed(
  current: WsConnectionStatus,
  details?: { code?: number; reason?: string },
): WsConnectionStatus {
  return applyDisconnect(current, {
    closeCode: details?.code ?? current.closeCode,
    closeReason: details?.reason?.trim() ? details.reason : current.closeReason,
  })
}

// ---------------------------------------------------------------------------
// Derived UI state
// ---------------------------------------------------------------------------

export function getWsUiState(status: WsConnectionStatus): WsUiState {
  if (status.phase === "connected") return "connected"
  if (!status.online && (status.disconnectedAt !== null || status.phase === "disconnected")) {
    return "offline"
  }
  if (status.reconnectPhase === "exhausted") return "exhausted"
  if (!status.hasConnected) {
    return status.phase === "disconnected" ? "error" : "connecting"
  }
  return "reconnecting"
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useWsConnectionStore = create<WsConnectionStore>((set) => ({
  status: INITIAL_WS_CONNECTION_STATUS,
  recordAttempt: () => set((s) => ({ status: applyAttempt(s.status) })),
  recordOpened: () => set((s) => ({ status: applyOpened(s.status) })),
  recordErrored: (message) => set((s) => ({ status: applyErrored(s.status, message) })),
  recordClosed: (details) => set((s) => ({ status: applyClosed(s.status, details) })),
  setOnline: (online) => set((s) => ({ status: { ...s.status, online } })),
  reset: () => set({ status: INITIAL_WS_CONNECTION_STATUS }),
}))

/** Non-React accessor. Mirrors t3code's getWsConnectionStatus. */
export const getWsConnectionStatus = () => useWsConnectionStore.getState().status

/** Convenience hook returning the derived UI state. */
export function useWsUiState(): WsUiState {
  return useWsConnectionStore((s) => getWsUiState(s.status))
}
