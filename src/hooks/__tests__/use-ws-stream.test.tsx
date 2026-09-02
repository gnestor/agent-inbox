// @vitest-environment jsdom
import React from "react"
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, act } from "@testing-library/react"

import {
  WsStreamProvider,
  useWsStream,
  PING_INTERVAL_MS,
  ALIVE_TIMEOUT_MS,
} from "../use-ws-stream"
import {
  useWsConnectionStore,
  WS_RECONNECT_MAX_DELAY_MS,
} from "../../stores/ws-connection-store"

// Minimal fake WebSocket that records sent frames and exposes the three
// event hooks we rely on.
class FakeWebSocket {
  static OPEN = 1
  static CLOSED = 3
  static instances: FakeWebSocket[] = []

  readyState = FakeWebSocket.OPEN
  onopen: ((e: unknown) => void) | null = null
  onmessage: ((e: unknown) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  onclose: ((e: unknown) => void) | null = null
  sent: string[] = []
  closeCalls = 0

  constructor(public url: string) {
    FakeWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.closeCalls++
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({ code: 1006, reason: "" })
  }

  simulateOpen() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.({})
    this.onmessage?.({ data: JSON.stringify({ type: "connected", clientId: "fake-client" }) })
  }

  simulateMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }
}

const originalWebSocket = globalThis.WebSocket

// This test file's tsconfig scope doesn't carry the ES2022 lib, so
// `Array.prototype.at` isn't typed here — use a plain last-element helper
// instead of `.at(-1)` throughout.
function last<T>(arr: readonly T[]): T {
  return arr[arr.length - 1] as T
}

beforeEach(() => {
  FakeWebSocket.instances = []
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
  // Also stash the static constants consumed by the hook
  ;(globalThis.WebSocket as unknown as { OPEN: number }).OPEN = FakeWebSocket.OPEN
  vi.useFakeTimers()
  useWsConnectionStore.getState().reset()
  // Reconnect delays are full-jittered by default (uniform 0..cap) — pin
  // Math.random to 1 so the jitter multiplier is exactly 1 and the schedule
  // is the deterministic upper bound the old, unjittered code produced.
  vi.spyOn(Math, "random").mockReturnValue(1)
})

afterEach(() => {
  globalThis.WebSocket = originalWebSocket
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function mount() {
  const ui = (
    <WsStreamProvider>
      <div>child</div>
    </WsStreamProvider>
  )
  return render(ui)
}

describe("useWsStream keepalive", () => {
  it("Scenario: Client pings on a fixed interval — sends a ping at PING_INTERVAL_MS while open", async () => {
    mount()
    const ws = last(FakeWebSocket.instances)
    act(() => ws.simulateOpen())

    act(() => { vi.advanceTimersByTime(PING_INTERVAL_MS) })

    const pings = ws.sent.filter((frame) => JSON.parse(frame).type === "ping")
    expect(pings).toHaveLength(1)
  })

  it("Scenario: Client force-closes on silent connection — force-closes the socket when no traffic arrives for ALIVE_TIMEOUT_MS", async () => {
    mount()
    const ws = last(FakeWebSocket.instances)
    act(() => ws.simulateOpen())

    // No further traffic for the full window (past the ping interval — that
    // ping frame is outbound and does not reset the watchdog).
    act(() => { vi.advanceTimersByTime(ALIVE_TIMEOUT_MS + 1_000) })

    expect(ws.closeCalls).toBeGreaterThanOrEqual(1)
  })

  it("any inbound message resets the alive watchdog", async () => {
    mount()
    const ws = last(FakeWebSocket.instances)
    act(() => ws.simulateOpen())

    // Just before the timeout, inject traffic that should reset it.
    act(() => { vi.advanceTimersByTime(ALIVE_TIMEOUT_MS - 5_000) })
    act(() => ws.simulateMessage({ type: "pong" }))
    act(() => { vi.advanceTimersByTime(ALIVE_TIMEOUT_MS - 5_000) })

    // We've advanced past the original deadline but the reset kept us alive.
    expect(ws.closeCalls).toBe(0)
  })

  it("Scenario: Server replies with pong — pong frames are silently absorbed (no session_event dispatch path)", async () => {
    mount()
    const ws = last(FakeWebSocket.instances)
    act(() => ws.simulateOpen())

    // Inject a pong, then a real event — the pong should not throw or cause
    // any side effect. (Nothing to assert beyond "no exceptions.")
    act(() => {
      ws.simulateMessage({ type: "pong" })
      ws.simulateMessage({ type: "session_event", sessionId: "s1", data: {} })
    })
  })
})

describe("useWsStream reconnect", () => {
  it("Scenario: Reconnect uses bounded exponential backoff — a live connection that drops reconnects after the first backoff delay", async () => {
    mount()
    // Math.random is pinned to 1 (see beforeEach), so the jittered delay is
    // exactly its unjittered upper bound (1s) — the first rung of the shared
    // backoff schedule (`ws-connection-store`'s `getWsReconnectDelayMsForRetry`).
    const ws0 = last(FakeWebSocket.instances)
    act(() => ws0.simulateOpen())
    act(() => ws0.close())
    expect(FakeWebSocket.instances).toHaveLength(1) // no new socket yet
    act(() => { vi.advanceTimersByTime(999) })
    expect(FakeWebSocket.instances).toHaveLength(1) // still waiting
    act(() => { vi.advanceTimersByTime(1) })
    expect(FakeWebSocket.instances).toHaveLength(2) // reconnected after 1s
  })

  it("Scenario: Reconnect uses bounded exponential backoff — caps at 64s and stops after the seventh retry (exhausted)", async () => {
    mount()
    // Attempt 1 (the initial connect from mount) fails without ever opening —
    // this is the same "never opens" streak the connection-store's own
    // `getWsReconnectDelayMsForRetry`/exhaustion tests use, so the schedule
    // below is the clean, unambiguous 1s-doubling-to-64s sequence.
    act(() => last(FakeWebSocket.instances).close())

    const expectedDelaysMs = [1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 64_000]
    expect(last(expectedDelaysMs)).toBe(WS_RECONNECT_MAX_DELAY_MS)

    for (const delayMs of expectedDelaysMs) {
      const before = FakeWebSocket.instances.length
      act(() => { vi.advanceTimersByTime(delayMs) })
      // Each of the 7 retries reconnects right on schedule, then immediately
      // fails again (never opening) to drive the next retry.
      expect(FakeWebSocket.instances.length).toBe(before + 1)
      act(() => last(FakeWebSocket.instances).close())
    }

    // The 8th connection attempt overall (the 7th retry, just closed above)
    // has now failed — the retry budget (WS_RECONNECT_MAX_RETRIES = 7) is
    // exhausted, matching what ws-connection-store already models.
    expect(useWsConnectionStore.getState().status.reconnectPhase).toBe("exhausted")

    // No further reconnect is scheduled, no matter how long we wait.
    const socketCountAtExhaustion = FakeWebSocket.instances.length
    act(() => { vi.advanceTimersByTime(10 * WS_RECONNECT_MAX_DELAY_MS) })
    expect(FakeWebSocket.instances.length).toBe(socketCountAtExhaustion)
  })

  it("reconnect timer fires exactly at the store's nextRetryAt, even under real (unpinned) jitter", async () => {
    // Undo this file's Math.random pin (see beforeEach) so the backoff
    // calculator draws real, non-deterministic jitter. The hook must derive
    // its setTimeout delay by reading `nextRetryAt` from the store rather
    // than recomputing the jittered value itself — recomputing would draw a
    // second, different random value and fire at the wrong instant.
    vi.spyOn(Math, "random").mockRestore()
    mount()
    const ws0 = last(FakeWebSocket.instances)
    act(() => ws0.simulateOpen())
    act(() => ws0.close())

    const nextRetryAt = useWsConnectionStore.getState().status.nextRetryAt
    expect(nextRetryAt).not.toBeNull()
    const expectedDelay = new Date(nextRetryAt as string).getTime() - Date.now()

    act(() => { vi.advanceTimersByTime(Math.max(0, expectedDelay - 1)) })
    expect(FakeWebSocket.instances).toHaveLength(1) // not yet — one ms early
    act(() => { vi.advanceTimersByTime(1) })
    expect(FakeWebSocket.instances).toHaveLength(2) // fires exactly on nextRetryAt
  })

  it("Scenario: Resubscribe uses the latest applied sequence — re-subscribe frame on reconnect carries each session's getFromSequence cursor", async () => {
    let seq = 0
    function Consumer() {
      const { subscribe } = useWsStream()
      React.useEffect(() => {
        return subscribe("s-cursor", () => {}, { getFromSequence: () => seq })
      }, [subscribe])
      return null
    }
    render(
      <WsStreamProvider>
        <Consumer />
      </WsStreamProvider>,
    )
    const ws0 = last(FakeWebSocket.instances)
    act(() => ws0.simulateOpen())
    // Flush the 50ms subscribe batch from the initial subscribe call.
    act(() => { vi.advanceTimersByTime(50) })

    // Client has now applied through sequence 7.
    seq = 7
    // Connection drops and reconnects.
    act(() => ws0.close())
    act(() => { vi.advanceTimersByTime(1000) })
    const ws1 = last(FakeWebSocket.instances)
    act(() => ws1.simulateOpen())

    // The resubscribe frame emitted on `connected` must carry fromSequence: 7.
    const subscribeFrames = ws1.sent
      .map((f) => JSON.parse(f))
      .filter((m) => m.type === "subscribe")
    const lastSub = last(subscribeFrames)
    expect(lastSub.sessions).toContainEqual({ id: "s-cursor", fromSequence: 7 })
  })
})
