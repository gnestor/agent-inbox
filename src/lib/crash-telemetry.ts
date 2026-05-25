// Crash telemetry: heartbeats + clean-unload flag for catching renderer
// crashes (e.g. Aw, Snap! / SBOX_FATAL_MEMORY_EXCEEDED) that Sentry-style
// error trackers can't see because the JS context dies before any handler
// runs. We periodically snapshot app state to localStorage (and POST to the
// server). On boot, if the last snapshot lacks a clean-unload mark, the
// previous tab crashed — we report it as a crash event with full pre-death
// context (heap MB, DOM count, iframes, open panels, route).

import { useNavigationStore } from "@/lib/navigation-store"
import { createLogger } from "@/lib/logger"

const log = createLogger("crash-telemetry")

const HEARTBEAT_KEY = "inbox:lastHeartbeat"
const CLEAN_UNLOAD_KEY = "inbox:cleanUnload"
const SESSION_ID_KEY = "inbox:telemetrySessionId"
const HEARTBEAT_INTERVAL_MS = 5_000

interface PerformanceMemory {
  usedJSHeapSize: number
  totalJSHeapSize: number
  jsHeapSizeLimit: number
}

function getMemory(): PerformanceMemory | undefined {
  return (performance as unknown as { memory?: PerformanceMemory }).memory
}

interface Heartbeat {
  ts: number
  sessionId: string
  route: string
  heapMB?: number
  heapLimitMB?: number
  heapPct?: number
  domNodes: number
  iframes: number
  panels: number
  activeTab: string
  longTasksSinceLastBeat: number
  appVersion: string
}

function getOrCreateSessionId(): string {
  let id = sessionStorage.getItem(SESSION_ID_KEY)
  if (!id) {
    id = crypto.randomUUID()
    sessionStorage.setItem(SESSION_ID_KEY, id)
  }
  return id
}

function countOpenPanels(): { panels: number; activeTab: string } {
  try {
    const s = useNavigationStore.getState()
    const panels = Object.values(s.tabs).reduce((n, t) => n + (t.panels?.length ?? 0), 0)
    return { panels, activeTab: s.activeTab }
  } catch {
    return { panels: 0, activeTab: "" }
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

function postBeacon(path: string, body: object) {
  try {
    const blob = new Blob([JSON.stringify(body)], { type: "application/json" })
    if (navigator.sendBeacon?.(path, blob)) return
  } catch {
    // fall through to fetch
  }
  void fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
    credentials: "same-origin",
  }).catch(() => {})
}

function checkPreviousSessionForCrash() {
  let raw: string | null = null
  let clean: string | null = null
  try {
    raw = localStorage.getItem(HEARTBEAT_KEY)
    clean = localStorage.getItem(CLEAN_UNLOAD_KEY)
  } catch {
    return
  }
  if (!raw) return

  let last: Heartbeat
  try {
    last = JSON.parse(raw)
  } catch {
    return
  }

  const cleanTs = clean ? Number(clean) : 0
  if (cleanTs >= last.ts) return

  const crash = {
    type: "crash" as const,
    detectedAt: Date.now(),
    secondsSinceLastBeat: Math.round((Date.now() - last.ts) / 1000),
    lastHeartbeat: last,
  }
  log.warn("Previous session ended without clean unload", crash)
  postBeacon("/api/telemetry/crash", crash)
}

let intervalHandle: number | undefined

export function initCrashTelemetry() {
  if (intervalHandle !== undefined) return
  if (typeof window === "undefined") return

  checkPreviousSessionForCrash()

  const sessionId = getOrCreateSessionId()
  let longTaskCount = 0

  try {
    const obs = new PerformanceObserver((list) => {
      longTaskCount += list.getEntries().length
    })
    obs.observe({ type: "longtask", buffered: true })
  } catch {
    // longtask not supported (Safari) — ignore
  }

  const tick = () => {
    // Skip when the tab is backgrounded — Chrome already throttles us to 1 Hz
    // there, but the data is also far less useful (no user activity, no crash
    // surface) and writes still cost JSON serialization + sync localStorage I/O.
    if (document.visibilityState !== "visible") return

    const mem = getMemory()
    const { panels, activeTab } = countOpenPanels()
    const beat: Heartbeat = {
      ts: Date.now(),
      sessionId,
      route: window.location.pathname + window.location.search,
      heapMB: mem ? round(mem.usedJSHeapSize / 1e6) : undefined,
      heapLimitMB: mem ? round(mem.jsHeapSizeLimit / 1e6) : undefined,
      heapPct: mem ? round(mem.usedJSHeapSize / mem.jsHeapSizeLimit) : undefined,
      domNodes: document.getElementsByTagName("*").length,
      iframes: document.querySelectorAll("iframe").length,
      panels,
      activeTab,
      longTasksSinceLastBeat: longTaskCount,
      // __APP_VERSION__ is injected by Vite (see vite.config.ts)
      appVersion: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev",
    }
    longTaskCount = 0
    try {
      localStorage.setItem(HEARTBEAT_KEY, JSON.stringify(beat))
    } catch {
      // localStorage full or disabled — skip persistence, still post
    }
    postBeacon("/api/telemetry/heartbeat", beat)
  }

  // Fire one immediately so a crash within the first 5s still has context.
  tick()
  intervalHandle = window.setInterval(tick, HEARTBEAT_INTERVAL_MS)

  // pagehide is more reliable than beforeunload on mobile/bfcache;
  // listen to both for safety.
  const markClean = () => {
    try {
      localStorage.setItem(CLEAN_UNLOAD_KEY, String(Date.now()))
    } catch {
      // ignore
    }
  }
  window.addEventListener("pagehide", markClean)
  window.addEventListener("beforeunload", markClean)
}
