import { vi, describe, it, expect, beforeEach, afterEach } from "vitest"
import type { Hono } from "hono"
import type { AppBindings } from "../workspace-context.js"

// ---------------------------------------------------------------------------
// Mock node:fs so we control watch/existsSync without touching the disk.
// ---------------------------------------------------------------------------

type WatchCb = (event: string, filename: string | null) => void
const watchCalls: { dir: string; cb: WatchCb }[] = []
const closeSpy = vi.fn()

const fakeWatcher = {
  on: vi.fn(),
  close: closeSpy,
}

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => true),
  watch: vi.fn((dir: string, _opts: unknown, cb: WatchCb) => {
    watchCalls.push({ dir, cb })
    return fakeWatcher
  }),
}))

const loadPluginsSpy = vi.fn(async () => {})
vi.mock("../plugin-loader.js", () => ({
  loadPlugins: (...args: unknown[]) => loadPluginsSpy(...args),
}))

const mountSpy = vi.fn()
vi.mock("../../routes/plugins.js", () => ({
  mountPluginRoutes: (...args: unknown[]) => mountSpy(...args),
}))

const { watchPlugins, stopWatching } = await import("../plugin-watcher.js")

const fakeApp = {} as Hono<AppBindings>

describe("plugin-watcher", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    watchCalls.length = 0
    vi.useFakeTimers()
  })

  afterEach(() => {
    stopWatching()
    vi.useRealTimers()
  })

  it("Scenario: Watcher reloads plugins on file changes with 500ms debounce — coalesces rapid events into a single reload", async () => {
    watchPlugins([{ id: "ws-1", path: "/workspace" }], fakeApp)
    expect(watchCalls).toHaveLength(1)
    const { cb } = watchCalls[0]

    // node_modules and dotfiles are ignored.
    cb("change", "node_modules/foo.js")
    cb("change", ".hidden")
    await vi.advanceTimersByTimeAsync(600)
    expect(loadPluginsSpy).not.toHaveBeenCalled()

    // Three rapid real saves debounce into one reload after 500ms.
    cb("change", "gmail/plugin.ts")
    cb("change", "gmail/plugin.ts")
    cb("change", "gmail/plugin.ts")
    await vi.advanceTimersByTimeAsync(499)
    expect(loadPluginsSpy).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2)
    expect(loadPluginsSpy).toHaveBeenCalledTimes(1)
    expect(loadPluginsSpy).toHaveBeenCalledWith("/workspace", "ws-1")
    expect(mountSpy).toHaveBeenCalledWith(fakeApp)
  })

  it("Scenario: Watcher cleanup on shutdown — clears pending timers and closes every FSWatcher", () => {
    watchPlugins([{ id: "ws-1", path: "/workspace" }], fakeApp)
    const { cb } = watchCalls[0]
    cb("change", "gmail/plugin.ts") // schedule a pending debounce timer

    stopWatching()

    expect(closeSpy).toHaveBeenCalled()
    // The pending reload timer was cleared — advancing time triggers nothing.
    vi.advanceTimersByTime(1000)
    expect(loadPluginsSpy).not.toHaveBeenCalled()
  })
})
