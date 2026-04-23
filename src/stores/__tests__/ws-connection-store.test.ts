// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest"
import {
  useWsConnectionStore,
  INITIAL_WS_CONNECTION_STATUS,
  applyAttempt,
  applyOpened,
  applyErrored,
  applyClosed,
  getWsUiState,
  getWsReconnectDelayMsForRetry,
  WS_RECONNECT_INITIAL_DELAY_MS,
  WS_RECONNECT_MAX_RETRIES,
  WS_RECONNECT_MAX_DELAY_MS,
} from "../ws-connection-store"

beforeEach(() => {
  useWsConnectionStore.getState().reset()
})

describe("applyAttempt", () => {
  it("moves idle -> connecting and bumps counters", () => {
    const a1 = applyAttempt(INITIAL_WS_CONNECTION_STATUS)
    expect(a1.phase).toBe("connecting")
    expect(a1.reconnectPhase).toBe("attempting")
    expect(a1.attemptCount).toBe(1)
    expect(a1.reconnectAttemptCount).toBe(1)
  })

  it("resets reconnectAttemptCount to 1 when transitioning from connected", () => {
    const opened = applyOpened(applyAttempt(INITIAL_WS_CONNECTION_STATUS))
    const nextAttempt = applyAttempt(opened)
    expect(nextAttempt.reconnectAttemptCount).toBe(1)
  })
})

describe("applyOpened", () => {
  it("clears retry state", () => {
    const attempted = applyAttempt(INITIAL_WS_CONNECTION_STATUS)
    const opened = applyOpened(attempted)
    expect(opened.phase).toBe("connected")
    expect(opened.reconnectPhase).toBe("idle")
    expect(opened.reconnectAttemptCount).toBe(0)
    expect(opened.hasConnected).toBe(true)
    expect(opened.connectedAt).not.toBeNull()
  })
})

describe("applyClosed / applyErrored", () => {
  it("computes nextRetryAt from reconnectAttemptCount", () => {
    const attempted = applyAttempt(INITIAL_WS_CONNECTION_STATUS)
    const closed = applyClosed(attempted, { code: 1006, reason: "abnormal" })
    expect(closed.phase).toBe("disconnected")
    expect(closed.reconnectPhase).toBe("waiting")
    expect(closed.nextRetryAt).not.toBeNull()
    expect(closed.closeCode).toBe(1006)
  })

  it("marks reconnectPhase exhausted after max retries", () => {
    let status = INITIAL_WS_CONNECTION_STATUS
    for (let i = 0; i < WS_RECONNECT_MAX_RETRIES + 1; i++) {
      status = applyAttempt(status)
      status = applyClosed(status)
      // Reset nextRetryAt so the next close recomputes — mirrors real flow where
      // the timer fires and a new attempt starts.
      status = { ...status, nextRetryAt: null }
    }
    expect(status.reconnectPhase).toBe("exhausted")
  })

  it("errored records lastError but falls through to disconnect math", () => {
    const attempted = applyAttempt(INITIAL_WS_CONNECTION_STATUS)
    const errored = applyErrored(attempted, "boom")
    expect(errored.lastError).toBe("boom")
    expect(errored.lastErrorAt).not.toBeNull()
    expect(errored.phase).toBe("disconnected")
  })
})

describe("getWsReconnectDelayMsForRetry", () => {
  it("first retry matches initial delay", () => {
    expect(getWsReconnectDelayMsForRetry(0)).toBe(WS_RECONNECT_INITIAL_DELAY_MS)
  })
  it("increases exponentially up to the cap", () => {
    const last = getWsReconnectDelayMsForRetry(WS_RECONNECT_MAX_RETRIES - 1)
    expect(last).toBeLessThanOrEqual(WS_RECONNECT_MAX_DELAY_MS)
  })
  it("returns null past the max", () => {
    expect(getWsReconnectDelayMsForRetry(WS_RECONNECT_MAX_RETRIES)).toBeNull()
    expect(getWsReconnectDelayMsForRetry(-1)).toBeNull()
  })
})

describe("getWsUiState", () => {
  it("maps connected -> connected", () => {
    const s = applyOpened(applyAttempt(INITIAL_WS_CONNECTION_STATUS))
    expect(getWsUiState(s)).toBe("connected")
  })

  it("maps first-connect failure -> connecting or error", () => {
    const s = applyAttempt(INITIAL_WS_CONNECTION_STATUS)
    expect(getWsUiState(s)).toBe("connecting")
    const closed = applyClosed(s)
    expect(getWsUiState(closed)).toBe("error")
  })

  it("maps post-disconnect with prior connect -> reconnecting", () => {
    let s = applyOpened(applyAttempt(INITIAL_WS_CONNECTION_STATUS))
    s = applyAttempt(s)
    s = applyClosed(s)
    expect(getWsUiState(s)).toBe("reconnecting")
  })

  it("maps offline after disconnect -> offline", () => {
    let s = applyOpened(applyAttempt(INITIAL_WS_CONNECTION_STATUS))
    s = applyClosed(s)
    s = { ...s, online: false }
    expect(getWsUiState(s)).toBe("offline")
  })
})

describe("store actions", () => {
  it("recordAttempt updates store", () => {
    useWsConnectionStore.getState().recordAttempt()
    expect(useWsConnectionStore.getState().status.phase).toBe("connecting")
  })

  it("recordOpened clears retry state", () => {
    useWsConnectionStore.getState().recordAttempt()
    useWsConnectionStore.getState().recordOpened()
    expect(useWsConnectionStore.getState().status.phase).toBe("connected")
    expect(useWsConnectionStore.getState().status.reconnectAttemptCount).toBe(0)
  })

  it("setOnline toggles navigator.onLine mirror", () => {
    useWsConnectionStore.getState().setOnline(false)
    expect(useWsConnectionStore.getState().status.online).toBe(false)
  })
})
