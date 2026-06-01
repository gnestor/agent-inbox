import { vi, describe, it, expect, beforeEach, afterEach } from "vitest"
import type { Plugin } from "../../../src/types/plugin.js"

// ---------------------------------------------------------------------------
// Mock fs/promises — controlled by individual tests
// ---------------------------------------------------------------------------

const readdirImpl = vi.fn<(path: string, opts?: unknown) => Promise<unknown[]>>()

const fsMock = {
  readdir: readdirImpl,
}

vi.mock("node:fs/promises", () => fsMock)

// Dynamic import AFTER mock is registered
const { loadPlugins, getPlugins, getPlugin, registerPlugin } = await import("../plugin-loader.js")

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlugin(overrides: Partial<Plugin> = {}): Plugin {
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

function makeImporter(map: Record<string, Plugin>) {
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

/** Helper: set up readdir to return given files for inbox-plugins/, ENOENT for plugins/ */
function mockInboxPlugins(files: string[]) {
  readdirImpl.mockImplementation(async (path: string) => {
    if (typeof path === "string" && path.includes("inbox-plugins")) return files
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
  })
}

describe("plugin-loader", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInboxPlugins([])
  })

  afterEach(() => {
    // Reset registry between tests
    ;(loadPlugins as unknown as { __resetForTest?: () => void }).__resetForTest?.()
  })

  // ── loadPlugins ───────────────────────────────────────────────────────────

  describe("loadPlugins", () => {
    it("results in empty registry when inbox-plugins directory does not exist", async () => {
      readdirImpl.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }))
      await loadPlugins("/fake/workspace")
      expect(getPlugins()).toHaveLength(0)
    })

    it("Scenario: A plugin is a default export with `id` plus at least one of `query`/`hasSkills`/`itemToContext` — loads a valid query plugin", async () => {
      mockInboxPlugins(["q.ts"])
      const plugin = makePlugin({ id: "q-plugin", name: "Q" })
      await loadPlugins("/fake/workspace", undefined, makeImporter({ "q.ts": plugin }))
      expect(getPlugin("q-plugin")).toBe(plugin)

      // hasSkills-only and itemToContext-only also validate
      mockInboxPlugins(["skills.ts", "ctx.ts"])
      const skillsOnly = { id: "skills-only", name: "S", icon: "X", hasSkills: true } as unknown as Plugin
      const ctxOnly = { id: "ctx-only", name: "C", icon: "X", itemToContext: () => "stub" } as unknown as Plugin
      await loadPlugins("/fake/workspace", undefined, makeImporter({ "skills.ts": skillsOnly, "ctx.ts": ctxOnly }))
      expect(getPlugin("skills-only")).toBeDefined()
      expect(getPlugin("ctx-only")).toBeDefined()
    })

    it("Scenario: A file may default-export `Plugin` or `Plugin[]` — an array export registers every plugin", async () => {
      mockInboxPlugins(["multi.ts"])
      const a = makePlugin({ id: "multi-a", name: "A" })
      const b = makePlugin({ id: "multi-b", name: "B" })
      const importer = async () => ({ default: [a, b] })
      await loadPlugins("/fake/workspace", undefined, importer)
      expect(getPlugin("multi-a")).toBe(a)
      expect(getPlugin("multi-b")).toBe(b)
    })

    it("loads a valid .ts plugin and adds it to the registry", async () => {
      mockInboxPlugins(["slack-plugin.ts"])
      const plugin = makePlugin({ id: "slack", name: "Slack" })
      await loadPlugins("/fake/workspace", undefined, makeImporter({ "slack-plugin.ts": plugin }))
      expect(getPlugins()).toHaveLength(1)
      expect(getPlugin("slack")).toBe(plugin)
    })

    it("loads a valid .js plugin", async () => {
      mockInboxPlugins(["github-plugin.js"])
      const plugin = makePlugin({ id: "github", name: "GitHub" })
      await loadPlugins("/fake/workspace", undefined, makeImporter({ "github-plugin.js": plugin }))
      expect(getPlugin("github")).toBeDefined()
    })

    it("skips files that are not .ts or .js", async () => {
      mockInboxPlugins(["README.md", "notes.txt"])
      await loadPlugins("/fake/workspace", undefined, makeImporter({}))
      expect(getPlugins()).toHaveLength(0)
    })

    it("skips a plugin that has no id field", async () => {
      mockInboxPlugins(["bad-plugin.ts"])
      const badPlugin = { name: "Bad", icon: "X", fieldSchema: [], query: async () => ({ items: [] }), mutate: async () => {} }
      await loadPlugins("/fake/workspace", undefined, async () => ({ default: badPlugin as unknown as Plugin }))
      expect(getPlugins()).toHaveLength(0)
    })

    it("skips a plugin with no query function", async () => {
      mockInboxPlugins(["bad-plugin.ts"])
      const badPlugin = { id: "bad", name: "Bad", icon: "X", fieldSchema: [], mutate: async () => {} }
      await loadPlugins("/fake/workspace", undefined, async () => ({ default: badPlugin as unknown as Plugin }))
      expect(getPlugins()).toHaveLength(0)
    })

    it("skips a plugin that throws during import and continues loading others", async () => {
      mockInboxPlugins(["broken.ts", "good-plugin.ts"])
      const good = makePlugin({ id: "good", name: "Good" })
      const importer = async (path: string) => {
        if (path.includes("broken")) throw new Error("Syntax error")
        return { default: good }
      }
      await loadPlugins("/fake/workspace", undefined, importer)
      expect(getPlugins()).toHaveLength(1)
      expect(getPlugin("good")).toBeDefined()
    })

    it("replaces existing registry on repeated calls (clears stale entries)", async () => {
      // First load: slack
      mockInboxPlugins(["slack-plugin.ts"])
      const slack = makePlugin({ id: "slack", name: "Slack" })
      await loadPlugins("/fake/workspace", undefined, makeImporter({ "slack-plugin.ts": slack }))
      expect(getPlugins()).toHaveLength(1)

      // Second load: only github
      mockInboxPlugins(["github-plugin.ts"])
      const github = makePlugin({ id: "github", name: "GitHub" })
      await loadPlugins("/fake/workspace", undefined, makeImporter({ "github-plugin.ts": github }))
      expect(getPlugins()).toHaveLength(1)
      expect(getPlugin("slack")).toBeUndefined()
      expect(getPlugin("github")).toBeDefined()
    })

    it("scans the inbox-plugins subdirectory of the given workspace path", async () => {
      mockInboxPlugins([])
      await loadPlugins("/my/workspace")
      expect(readdirImpl).toHaveBeenCalledWith(expect.stringContaining("inbox-plugins"))
      expect(readdirImpl).toHaveBeenCalledWith(expect.stringContaining("/my/workspace"))
    })
  })

  // ── discovery, builtins, merge ─────────────────────────────────────────────

  describe("discovery and registry", () => {
    /** readdir mock for the new {workspace}/plugins/<dir>/plugin.ts convention. */
    function mockWorkspacePluginDirs(dirs: string[]) {
      readdirImpl.mockImplementation(async (path: string, opts?: unknown) => {
        if (typeof path === "string" && path.endsWith("/plugins") && opts) {
          return dirs.map((name) => ({ name, isDirectory: () => true }))
        }
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
      })
    }

    it("Scenario: Built-in plugins are loaded once and survive workspace reloads — registerPlugin survives non-builtin clears", async () => {
      const builtin = makePlugin({ id: "gmail", name: "Emails" })
      registerPlugin(builtin)
      expect(getPlugin("gmail")).toBe(builtin)
      // A subsequent workspace-less reload clears only non-builtin entries.
      mockInboxPlugins([])
      await loadPlugins("/fake/workspace")
      expect(getPlugin("gmail")).toBe(builtin)
    })

    it("Scenario: Workspace plugins live in `{workspace}/plugins/*/plugin.ts`, with legacy fallback — scans new dir then inbox-plugins", async () => {
      const wsPlugin = makePlugin({ id: "ws-only", name: "WS" })
      readdirImpl.mockImplementation(async (path: string, opts?: unknown) => {
        if (typeof path === "string" && path.endsWith("/plugins") && opts) {
          return [{ name: "ws-only", isDirectory: () => true }]
        }
        if (typeof path === "string" && path.includes("inbox-plugins")) return ["legacy.ts"]
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
      })
      const legacy = makePlugin({ id: "legacy-only", name: "Legacy" })
      await loadPlugins("/fake/workspace", "ws-1", makeImporter({ "plugin.ts": wsPlugin, "legacy.ts": legacy }))
      expect(getPlugin("ws-only", "ws-1")).toBeDefined()
      expect(getPlugin("legacy-only", "ws-1")).toBeDefined()
    })

    it("Scenario: `getPlugins(workspaceId)` merges workspace registry on top of built-ins — workspace overrides builtin by id", async () => {
      const builtinGmail = makePlugin({ id: "gmail", name: "Builtin Gmail" })
      registerPlugin(builtinGmail)
      mockWorkspacePluginDirs(["gmail"])
      const wsGmail = makePlugin({ id: "gmail", name: "Workspace Gmail" })
      await loadPlugins("/fake/workspace", "ws-1", makeImporter({ "plugin.ts": wsGmail }))
      // With workspace id, the workspace plugin wins ties.
      expect(getPlugins("ws-1").find((p) => p.id === "gmail")!.name).toBe("Workspace Gmail")
      // Without a workspace id, only builtins are guaranteed.
      expect(getPlugins().find((p) => p.id === "gmail")).toBeDefined()
    })
  })

  // ── validation safety ──────────────────────────────────────────────────────

  describe("validation safety", () => {
    it("Scenario: Plugin loader tolerates ENOENT and ERR_MODULE_NOT_FOUND silently — continues, logs other errors", async () => {
      // ENOENT for both plugins/ and inbox-plugins/ → empty registry, no throw.
      readdirImpl.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }))
      await expect(loadPlugins("/fake/workspace")).resolves.toBeUndefined()
      expect(getPlugins()).toHaveLength(0)

      // A module that throws at import is skipped without aborting the loader.
      mockInboxPlugins(["broken.ts", "good.ts"])
      const good = makePlugin({ id: "good", name: "Good" })
      const importer = async (path: string) => {
        if (path.includes("broken")) throw new Error("parse failure")
        return { default: good }
      }
      await loadPlugins("/fake/workspace", undefined, importer)
      expect(getPlugin("good")).toBeDefined()
    })
  })

  // ── getPlugin ─────────────────────────────────────────────────────────────

  describe("getPlugin", () => {
    it("returns undefined for an unknown id", async () => {
      mockInboxPlugins([])
      await loadPlugins("/fake/workspace")
      expect(getPlugin("nope")).toBeUndefined()
    })

    it("returns the plugin by id", async () => {
      mockInboxPlugins(["p.ts"])
      const plugin = makePlugin({ id: "myp", name: "My Plugin" })
      await loadPlugins("/fake/workspace", undefined, makeImporter({ "p.ts": plugin }))
      expect(getPlugin("myp")).toBe(plugin)
    })
  })

  // ── getPlugins ────────────────────────────────────────────────────────────

  describe("getPlugins", () => {
    it("returns all loaded plugins as an array", async () => {
      mockInboxPlugins(["a.ts", "b.ts"])
      const a = makePlugin({ id: "a" })
      const b = makePlugin({ id: "b" })
      await loadPlugins("/fake/workspace", undefined, makeImporter({ "a.ts": a, "b.ts": b }))
      const plugins = getPlugins()
      expect(plugins).toHaveLength(2)
      expect(plugins.map(p => p.id)).toEqual(expect.arrayContaining(["a", "b"]))
    })

    it("returns a snapshot array — not the internal registry reference", async () => {
      mockInboxPlugins([])
      await loadPlugins("/fake/workspace")
      const arr1 = getPlugins()
      const arr2 = getPlugins()
      expect(arr1).not.toBe(arr2)
    })
  })
})
