// @vitest-environment jsdom
import React from "react"
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, act } from "@testing-library/react"

import {
  WsStreamProvider,
  PING_INTERVAL_MS,
  ALIVE_TIMEOUT_MS,
} from "../use-ws-stream"

// Minimal fake WebSocket that records sent frames and exposes the three
// event hooks we rely on.
class FakeWebSocket {
  static OPEN = 1
  static CLOSED = 3
  static instances: FakeWebSocket[] = []

  readyState = FakeWebSocket.OPEN
  onopen: ((e: any) => void) | null = null
  onmessage: ((e: any) => void) | null = null
  onerror: ((e: any) => void) | null = null
  onclose: ((e: any) => void) | null = null
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

beforeEach(() => {
  FakeWebSocket.instances = []
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
  // Also stash the static constants consumed by the hook
  ;(globalThis.WebSocket as any).OPEN = FakeWebSocket.OPEN
  vi.useFakeTimers()
})

afterEach(() => {
  globalThis.WebSocket = originalWebSocket
  vi.useRealTimers()
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
  it("sends a ping at PING_INTERVAL_MS while open", async () => {
    mount()
    const ws = FakeWebSocket.instances.at(-1)!
    act(() => ws.simulateOpen())

    act(() => { vi.advanceTimersByTime(PING_INTERVAL_MS) })

    const pings = ws.sent.filter((frame) => JSON.parse(frame).type === "ping")
    expect(pings).toHaveLength(1)
  })

  it("force-closes the socket when no traffic arrives for ALIVE_TIMEOUT_MS", async () => {
    mount()
    const ws = FakeWebSocket.instances.at(-1)!
    act(() => ws.simulateOpen())

    // No further traffic for the full window (past the ping interval — that
    // ping frame is outbound and does not reset the watchdog).
    act(() => { vi.advanceTimersByTime(ALIVE_TIMEOUT_MS + 1_000) })

    expect(ws.closeCalls).toBeGreaterThanOrEqual(1)
  })

  it("any inbound message resets the alive watchdog", async () => {
    mount()
    const ws = FakeWebSocket.instances.at(-1)!
    act(() => ws.simulateOpen())

    // Just before the timeout, inject traffic that should reset it.
    act(() => { vi.advanceTimersByTime(ALIVE_TIMEOUT_MS - 5_000) })
    act(() => ws.simulateMessage({ type: "pong" }))
    act(() => { vi.advanceTimersByTime(ALIVE_TIMEOUT_MS - 5_000) })

    // We've advanced past the original deadline but the reset kept us alive.
    expect(ws.closeCalls).toBe(0)
  })

  it("pong frames are silently absorbed (no session_event dispatch path)", async () => {
    mount()
    const ws = FakeWebSocket.instances.at(-1)!
    act(() => ws.simulateOpen())

    // Inject a pong, then a real event — the pong should not throw or cause
    // any side effect. (Nothing to assert beyond "no exceptions.")
    act(() => {
      ws.simulateMessage({ type: "pong" })
      ws.simulateMessage({ type: "session_event", sessionId: "s1", data: {} })
    })
  })
})
