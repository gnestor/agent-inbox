import { vi, describe, it, expect, beforeEach, afterEach } from "vitest"
import type { SourcePlugin } from "../../../src/types/plugin.js"

// ---------------------------------------------------------------------------
// Mock fs/promises — controlled by individual tests
// ---------------------------------------------------------------------------

const fsMock = {
  readdir: vi.fn<() => Promise<string[]>>(),
}

vi.mock("node:fs/promises", () => fsMock)

// Dynamic import AFTER mock is registered
const { loadPlugins, getPlugins, getPlugin } = await import("../plugin-loader.js")

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlugin(overrides: Partial<SourcePlugin> = {}): SourcePlugin {
  return {
    id: "test-source",
    name: "Test Source",
    icon: "Box",
    fieldSchema: [],
    async query() { return { items: [] } },
    async mutate() {},
    ...overrides,
  }
}

function makeImporter(map: Record<string, SourcePlugin>) {
  return async (path: string) => {
    const filename = path.split("/").pop()!
    const plugin = map[filename]
    if (!plugin) throw new Error(`Module not found: ${path}`)
    return { default: plugin }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("plugin-loader", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    // Reset registry between tests
    loadPlugins.__resetForTest?.()
  })

  // ── loadPlugins ───────────────────────────────────────────────────────────

  describe("loadPlugins", () => {
    it("results in empty registry when inbox-plugins directory does not exist", async () => {
      fsMock.readdir.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }))
      await loadPlugins("/fake/workspace")
      expect(getPlugins()).toHaveLength(0)
    })

    it("loads a valid .ts plugin and adds it to the registry", async () => {
      fsMock.readdir.mockResolvedValue(["slack-plugin.ts"])
      const plugin = makePlugin({ id: "slack", name: "Slack" })
      await loadPlugins("/fake/workspace", makeImporter({ "slack-plugin.ts": plugin }))
      expect(getPlugins()).toHaveLength(1)
      expect(getPlugin("slack")).toBe(plugin)
    })

    it("loads a valid .js plugin", async () => {
      fsMock.readdir.mockResolvedValue(["github-plugin.js"])
      const plugin = makePlugin({ id: "github", name: "GitHub" })
      await loadPlugins("/fake/workspace", makeImporter({ "github-plugin.js": plugin }))
      expect(getPlugin("github")).toBeDefined()
    })

    it("skips files that are not .ts or .js", async () => {
      fsMock.readdir.mockResolvedValue(["README.md", "notes.txt"])
      await loadPlugins("/fake/workspace", makeImporter({}))
      expect(getPlugins()).toHaveLength(0)
    })

    it("skips a plugin that has no id field", async () => {
      fsMock.readdir.mockResolvedValue(["bad-plugin.ts"])
      const badPlugin = { name: "Bad", icon: "X", fieldSchema: [], query: async () => ({ items: [] }), mutate: async () => {} }
      await loadPlugins("/fake/workspace", async () => ({ default: badPlugin as unknown as SourcePlugin }))
      expect(getPlugins()).toHaveLength(0)
    })

    it("skips a plugin with no query function", async () => {
      fsMock.readdir.mockResolvedValue(["bad-plugin.ts"])
      const badPlugin = { id: "bad", name: "Bad", icon: "X", fieldSchema: [], mutate: async () => {} }
      await loadPlugins("/fake/workspace", async () => ({ default: badPlugin as unknown as SourcePlugin }))
      expect(getPlugins()).toHaveLength(0)
    })

    it("skips a plugin that throws during import and continues loading others", async () => {
      fsMock.readdir.mockResolvedValue(["broken.ts", "good-plugin.ts"])
      const good = makePlugin({ id: "good", name: "Good" })
      const importer = async (path: string) => {
        if (path.includes("broken")) throw new Error("Syntax error")
        return { default: good }
      }
      await loadPlugins("/fake/workspace", importer)
      expect(getPlugins()).toHaveLength(1)
      expect(getPlugin("good")).toBeDefined()
    })

    it("replaces existing registry on repeated calls (clears stale entries)", async () => {
      // First load: slack
      fsMock.readdir.mockResolvedValueOnce(["slack-plugin.ts"])
      const slack = makePlugin({ id: "slack", name: "Slack" })
      await loadPlugins("/fake/workspace", makeImporter({ "slack-plugin.ts": slack }))
      expect(getPlugins()).toHaveLength(1)

      // Second load: only github
      fsMock.readdir.mockResolvedValueOnce(["github-plugin.ts"])
      const github = makePlugin({ id: "github", name: "GitHub" })
      await loadPlugins("/fake/workspace", makeImporter({ "github-plugin.ts": github }))
      expect(getPlugins()).toHaveLength(1)
      expect(getPlugin("slack")).toBeUndefined()
      expect(getPlugin("github")).toBeDefined()
    })

    it("scans the inbox-plugins subdirectory of the given workspace path", async () => {
      fsMock.readdir.mockResolvedValue([])
      await loadPlugins("/my/workspace")
      expect(fsMock.readdir).toHaveBeenCalledWith(expect.stringContaining("inbox-plugins"))
      expect(fsMock.readdir).toHaveBeenCalledWith(expect.stringContaining("/my/workspace"))
    })
  })

  // ── getPlugin ─────────────────────────────────────────────────────────────

  describe("getPlugin", () => {
    it("returns undefined for an unknown id", async () => {
      fsMock.readdir.mockResolvedValue([])
      await loadPlugins("/fake/workspace")
      expect(getPlugin("nope")).toBeUndefined()
    })

    it("returns the plugin by id", async () => {
      fsMock.readdir.mockResolvedValue(["p.ts"])
      const plugin = makePlugin({ id: "myp", name: "My Plugin" })
      await loadPlugins("/fake/workspace", makeImporter({ "p.ts": plugin }))
      expect(getPlugin("myp")).toBe(plugin)
    })
  })

  // ── getPlugins ────────────────────────────────────────────────────────────

  describe("getPlugins", () => {
    it("returns all loaded plugins as an array", async () => {
      fsMock.readdir.mockResolvedValue(["a.ts", "b.ts"])
      const a = makePlugin({ id: "a" })
      const b = makePlugin({ id: "b" })
      await loadPlugins("/fake/workspace", makeImporter({ "a.ts": a, "b.ts": b }))
      const plugins = getPlugins()
      expect(plugins).toHaveLength(2)
      expect(plugins.map(p => p.id)).toEqual(expect.arrayContaining(["a", "b"]))
    })

    it("returns a snapshot array — not the internal registry reference", async () => {
      fsMock.readdir.mockResolvedValue([])
      await loadPlugins("/fake/workspace")
      const arr1 = getPlugins()
      const arr2 = getPlugins()
      expect(arr1).not.toBe(arr2)
    })
  })
})
