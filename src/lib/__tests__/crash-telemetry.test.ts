// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// __APP_VERSION__ is injected by Vite at build time; define it for tests.
;(globalThis as Record<string, unknown>).__APP_VERSION__ = "test-version"

// Avoid pulling the full Zustand navigation store.
vi.mock("@/lib/navigation-store", () => ({
  useNavigationStore: {
    getState: () => ({ tabs: { a: { panels: [1, 2] } }, activeTab: "a" }),
  },
}))

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
  }),
}))

const HEARTBEAT_KEY = "inbox:lastHeartbeat"
const CLEAN_UNLOAD_KEY = "inbox:cleanUnload"

// Captures every (path, body) sent through navigator.sendBeacon.
const beacons: { path: string; body: string }[] = []

let bustCounter = 0
async function loadModule(bust: string) {
  bustCounter += 1
  return import(/* @vite-ignore */ `../crash-telemetry?${bust}=${bustCounter}`)
}

describe("crash telemetry (client)", () => {
  function makeStorage(): Storage {
    const map = new Map<string, string>()
    return {
      get length() {
        return map.size
      },
      clear: () => map.clear(),
      getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
      setItem: (k: string, v: string) => void map.set(k, String(v)),
      removeItem: (k: string) => void map.delete(k),
      key: (i: number) => Array.from(map.keys())[i] ?? null,
    }
  }

  beforeEach(() => {
    vi.useFakeTimers()
    beacons.length = 0
    // jsdom's Storage is unreliable here — install in-memory stubs.
    vi.stubGlobal("localStorage", makeStorage())
    vi.stubGlobal("sessionStorage", makeStorage())
    // Stub sendBeacon to record posts synchronously.
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      writable: true,
      value: (path: string, blob: Blob) => {
        const body = (blob as unknown as { _text?: string })._text ?? ""
        beacons.push({ path, body })
        return true
      },
    })
    // jsdom Blob doesn't expose text synchronously — capture the source string.
    const RealBlob = globalThis.Blob
    vi.stubGlobal(
      "Blob",
      class extends RealBlob {
        _text: string
        constructor(parts: BlobPart[], opts?: BlobPropertyBag) {
          super(parts, opts)
          this._text = parts.map((p) => String(p)).join("")
        }
      },
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("Scenario: Heartbeat captures pre-crash app state — writes localStorage + posts /api/telemetry/heartbeat", async () => {
    const { initCrashTelemetry } = await loadModule("hb")
    initCrashTelemetry()

    // initCrashTelemetry fires one heartbeat immediately.
    const stored = localStorage.getItem(HEARTBEAT_KEY)
    expect(stored).toBeTruthy()
    const beat = JSON.parse(stored!) as Record<string, unknown>
    expect(beat).toMatchObject({ panels: 2, activeTab: "a", appVersion: "test-version" })
    expect(beat.ts).toBeTypeOf("number")
    expect(beat.domNodes).toBeTypeOf("number")

    const hbBeacon = beacons.find((b) => b.path === "/api/telemetry/heartbeat")
    expect(hbBeacon).toBeTruthy()
  })

  it("Scenario: Clean unload prevents false crash reports — cleanUnload >= lastHeartbeat means no crash posted", async () => {
    // Seed a prior heartbeat with a clean-unload stamp at or after it.
    localStorage.setItem(HEARTBEAT_KEY, JSON.stringify({ ts: 1000, route: "/x" }))
    localStorage.setItem(CLEAN_UNLOAD_KEY, String(2000))

    const { initCrashTelemetry } = await loadModule("clean")
    initCrashTelemetry()

    expect(beacons.some((b) => b.path === "/api/telemetry/crash")).toBe(false)
  })

  it("Scenario: Missing clean-unload mark surfaces as a crash — posts /api/telemetry/crash with the last heartbeat", async () => {
    // Prior heartbeat with NO matching clean-unload (or an older one).
    localStorage.setItem(HEARTBEAT_KEY, JSON.stringify({ ts: 5000, route: "/y" }))
    localStorage.setItem(CLEAN_UNLOAD_KEY, String(1000))

    const { initCrashTelemetry } = await loadModule("crash")
    initCrashTelemetry()

    const crashBeacon = beacons.find((b) => b.path === "/api/telemetry/crash")
    expect(crashBeacon).toBeTruthy()
    const payload = JSON.parse(crashBeacon!.body) as Record<string, unknown>
    expect(payload.type).toBe("crash")
    expect((payload.lastHeartbeat as { ts: number }).ts).toBe(5000)
    expect(payload.secondsSinceLastBeat).toBeTypeOf("number")
  })
})
