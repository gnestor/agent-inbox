import { vi, describe, it, expect, beforeEach, afterEach } from "vitest"
import type { Hono } from "hono"
import type { AppBindings } from "../workspace-context.js"

interface FakeDirent {
  name: string
  isDirectory(): boolean
  isFile(): boolean
}

interface FakeStat {
  mtimeMs: number
  size: number
  isFile(): boolean
}

const directories = new Map<string, FakeDirent[]>()
const files = new Map<string, FakeStat>()

const readdirSpy = vi.fn(async (path: string): Promise<FakeDirent[]> => {
  const entries = directories.get(path)
  if (!entries) throw Object.assign(new Error(`missing directory: ${path}`), { code: "ENOENT" })
  return entries
})

const statSpy = vi.fn(async (path: string): Promise<FakeStat> => {
  const entry = files.get(path)
  if (!entry) throw Object.assign(new Error(`missing file: ${path}`), { code: "ENOENT" })
  return entry
})

vi.mock("node:fs/promises", () => ({
  readdir: (path: string) => readdirSpy(path),
  stat: (path: string) => statSpy(path),
}))

const nativeWatchSpy = vi.fn(() => {
  throw Object.assign(new Error("too many open files, watch"), { code: "EMFILE" })
})

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => true),
  watch: nativeWatchSpy,
}))

const loadPluginsSpy = vi.fn(async (..._args: unknown[]) => {})
vi.mock("../plugin-loader.js", () => ({
  loadPlugins: (...args: unknown[]) => loadPluginsSpy(...args),
}))

const mountSpy = vi.fn((..._args: unknown[]) => {})
vi.mock("../../routes/plugins.js", () => ({
  mountPluginRoutes: (...args: unknown[]) => mountSpy(...args),
}))

const { watchPlugins, stopWatching } = await import("../plugin-watcher.js")

const fakeApp = {} as Hono<AppBindings>

function directory(name: string): FakeDirent {
  return { name, isDirectory: () => true, isFile: () => false }
}

function file(name: string): FakeDirent {
  return { name, isDirectory: () => false, isFile: () => true }
}

function setFile(path: string, mtimeMs: number, size = 100): void {
  files.set(path, { mtimeMs, size, isFile: () => true })
}

async function startWatcher(): Promise<void> {
  watchPlugins([{ id: "ws-1", path: "/workspace" }], fakeApp)
  await vi.advanceTimersByTimeAsync(0)
}

describe("plugin-watcher", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    directories.clear()
    files.clear()
    vi.useFakeTimers()

    directories.set("/workspace/inbox", [directory("gmail")])
    directories.set("/workspace/plugins", [directory("studio-only")])
    directories.set("/workspace/inbox-plugins", [file("legacy.ts"), file("README.md")])
    setFile("/workspace/inbox/gmail/plugin.ts", 1)
    setFile("/workspace/inbox-plugins/legacy.ts", 1)
  })

  afterEach(() => {
    stopWatching()
    vi.useRealTimers()
  })

  it("Scenario: Polling watches only loadable plugin entrypoints and cannot exhaust native watchers", async () => {
    await startWatcher()

    expect(nativeWatchSpy).not.toHaveBeenCalled()
    expect(statSpy.mock.calls.map(([path]) => path)).toEqual(expect.arrayContaining([
      "/workspace/inbox/gmail/plugin.ts",
      "/workspace/inbox/gmail/plugin.js",
      "/workspace/plugins/studio-only/plugin.ts",
      "/workspace/plugins/studio-only/plugin.js",
      "/workspace/inbox-plugins/legacy.ts",
    ]))
    expect(statSpy.mock.calls.some(([path]) => path.includes("node_modules"))).toBe(false)
    expect(loadPluginsSpy).not.toHaveBeenCalled()
  })

  it("Scenario: Changed, added, and removed entrypoints coalesce into one reload", async () => {
    await startWatcher()

    setFile("/workspace/inbox/gmail/plugin.ts", 2)
    directories.get("/workspace/inbox")?.push(directory("notion"))
    setFile("/workspace/inbox/notion/plugin.ts", 1)
    files.delete("/workspace/inbox-plugins/legacy.ts")

    await vi.advanceTimersByTimeAsync(1_000)
    expect(loadPluginsSpy).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(499)
    expect(loadPluginsSpy).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2)

    expect(loadPluginsSpy).toHaveBeenCalledTimes(1)
    expect(loadPluginsSpy).toHaveBeenCalledWith("/workspace", "ws-1")
    expect(mountSpy).toHaveBeenCalledWith(fakeApp)
  })

  it("Scenario: Watcher cleanup clears polling and pending reload timers", async () => {
    await startWatcher()
    setFile("/workspace/inbox/gmail/plugin.ts", 2)
    await vi.advanceTimersByTimeAsync(1_000)
    const readsBeforeStop = readdirSpy.mock.calls.length

    stopWatching()
    await vi.advanceTimersByTimeAsync(2_000)

    expect(readdirSpy).toHaveBeenCalledTimes(readsBeforeStop)
    expect(loadPluginsSpy).not.toHaveBeenCalled()
  })
})
