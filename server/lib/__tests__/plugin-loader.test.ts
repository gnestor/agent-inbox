import { vi, describe, it, expect, beforeEach, afterEach } from "vitest"
import type { Plugin } from "../../../src/types/plugin.js"

// ---------------------------------------------------------------------------
// Mock fs/promises — controlled by individual tests
// ---------------------------------------------------------------------------

const readdirImpl = vi.fn<(path: string, opts?: unknown) => Promise<unknown[]>>()
const accessImpl = vi.fn<(path: string) => Promise<void>>()
const readFileImpl = vi.fn<(path: string, encoding: string) => Promise<string>>()

const fsMock = {
  readdir: readdirImpl,
  access: accessImpl,
  readFile: readFileImpl,
}

vi.mock("node:fs/promises", () => fsMock)

// Dynamic import AFTER mock is registered
const { loadPlugins, getPlugins, getPlugin, getSkillPluginPaths, getPluginDir } = await import("../plugin-loader.js")

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
    if (!plugin) throw Object.assign(new Error(`Module not found: ${path}`), { code: "ENOENT" })
    return { default: plugin }
  }
}

/** Make a DirEntry-like object (withFileTypes) */
function makeDirEntry(name: string, isDir = false): { name: string; isDirectory: () => boolean } {
  return { name, isDirectory: () => isDir }
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
  // By default, no .claude-plugin/ directories
  accessImpl.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }))
}

/**
 * Helper: set up a workspace plugins/ directory with named subdirectories.
 * Each entry in `pluginDirs` can specify: name, hasClaudePlugin, and skills.
 */
function mockWorkspacePlugins(
  pluginDirs: Array<{
    name: string
    hasClaudePlugin?: boolean
    pluginJsonName?: string
    skills?: Array<{ name: string; frontmatter: string }>
  }>
) {
  const dirNames = pluginDirs.map((d) => d.name)

  readdirImpl.mockImplementation(async (path: string) => {
    if (typeof path === "string" && path.endsWith("/plugins")) {
      return pluginDirs.map((d) => makeDirEntry(d.name, true))
    }
    // skills/ subdir
    for (const dir of pluginDirs) {
      if (typeof path === "string" && path.endsWith(`/${dir.name}/skills`) && dir.skills) {
        return dir.skills.map((s) => makeDirEntry(s.name, true))
      }
    }
    if (typeof path === "string" && path.includes("inbox-plugins")) return []
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
  })

  accessImpl.mockImplementation(async (path: string) => {
    for (const dir of pluginDirs) {
      if (
        typeof path === "string" &&
        path.includes(`/${dir.name}/.claude-plugin/plugin.json`)
      ) {
        if (dir.hasClaudePlugin) return
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
      }
    }
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
  })

  readFileImpl.mockImplementation(async (path: string) => {
    // plugin.json reads
    for (const dir of pluginDirs) {
      if (typeof path === "string" && path.includes(`/${dir.name}/.claude-plugin/plugin.json`)) {
        return JSON.stringify({ name: dir.pluginJsonName ?? dir.name })
      }
    }
    // SKILL.md reads
    for (const dir of pluginDirs) {
      if (!dir.skills) continue
      for (const skill of dir.skills) {
        if (typeof path === "string" && path.includes(`/${dir.name}/skills/${skill.name}/SKILL.md`)) {
          return skill.frontmatter
        }
      }
    }
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
  })

  return dirNames
}

describe("plugin-loader", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInboxPlugins([])
  })

  afterEach(() => {
    // Reset registry between tests
    loadPlugins.__resetForTest?.()
  })

  // ── loadPlugins ───────────────────────────────────────────────────────────

  describe("loadPlugins", () => {
    it("results in empty registry when inbox-plugins directory does not exist", async () => {
      readdirImpl.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }))
      await loadPlugins("/fake/workspace")
      expect(getPlugins()).toHaveLength(0)
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

    it("skips a plugin with no query function (and no .claude-plugin/)", async () => {
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

  // ── skills-only plugins ───────────────────────────────────────────────────

  describe("skills-only plugins", () => {
    it("loads a skills-only plugin (no plugin.ts, has .claude-plugin/) with hasSkills: true", async () => {
      mockWorkspacePlugins([
        {
          name: "context-management",
          hasClaudePlugin: true,
          pluginJsonName: "Context Management",
          skills: [
            {
              name: "context-backfill",
              frontmatter: "---\nname: context-backfill\ndescription: Backfill context\n---\n# Instructions\n...",
            },
          ],
        },
      ])

      await loadPlugins("/fake/workspace", makeImporter({}))

      const plugin = getPlugin("context-management")
      expect(plugin).toBeDefined()
      expect(plugin!.hasSkills).toBe(true)
      expect(plugin!.name).toBe("Context Management")
      expect(plugin!.query).toBeUndefined()
    })

    it("skills-only plugin is NOT returned by data-source filter (no query function)", async () => {
      mockWorkspacePlugins([
        {
          name: "context-management",
          hasClaudePlugin: true,
          pluginJsonName: "Context Management",
          skills: [],
        },
      ])

      await loadPlugins("/fake/workspace", makeImporter({}))

      // Plugin is in registry
      expect(getPlugin("context-management")).toBeDefined()
      // But it has no query — consumers filtering for tabs should filter it out
      const tabPlugins = getPlugins().filter((p) => typeof p.query === "function")
      expect(tabPlugins).toHaveLength(0)
    })

    it("skills-only plugin falls back to directory name when plugin.json has no name", async () => {
      readdirImpl.mockImplementation(async (path: string) => {
        if (typeof path === "string" && path.endsWith("/plugins")) {
          return [makeDirEntry("my-plugin", true)]
        }
        if (typeof path === "string" && path.includes("inbox-plugins")) return []
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
      })
      accessImpl.mockImplementation(async (path: string) => {
        if (typeof path === "string" && path.includes("/my-plugin/.claude-plugin/plugin.json")) return
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
      })
      readFileImpl.mockImplementation(async (path: string) => {
        if (typeof path === "string" && path.includes("/my-plugin/.claude-plugin/plugin.json")) {
          return JSON.stringify({}) // no name field
        }
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
      })

      await loadPlugins("/fake/workspace", makeImporter({}))

      const plugin = getPlugin("my-plugin")
      expect(plugin).toBeDefined()
      expect(plugin!.name).toBe("my-plugin") // fallback to dir name
    })
  })

  // ── skill frontmatter parsing ─────────────────────────────────────────────

  describe("skill frontmatter parsing", () => {
    it("parses skill frontmatter into skillManifest[]", async () => {
      mockWorkspacePlugins([
        {
          name: "gmail",
          hasClaudePlugin: true,
          pluginJsonName: "Gmail",
          skills: [
            {
              name: "process-email",
              frontmatter: [
                "---",
                "name: process-email",
                "description: Process a single email",
                "category: process",
                "triggers:",
                "  - process this email",
                "  - handle this email",
                "---",
                "# Instructions",
              ].join("\n"),
            },
          ],
        },
      ])

      const gmailPlugin = makePlugin({ id: "gmail", name: "Gmail" })
      await loadPlugins("/fake/workspace", makeImporter({ "plugin.ts": gmailPlugin }))

      const plugin = getPlugin("gmail")
      expect(plugin).toBeDefined()
      expect(plugin!.hasSkills).toBe(true)
      expect(plugin!.skillManifest).toHaveLength(1)

      const skill = plugin!.skillManifest![0]
      expect(skill.name).toBe("process-email")
      expect(skill.description).toBe("Process a single email")
      expect(skill.category).toBe("process")
      expect(skill.triggers).toEqual(["process this email", "handle this email"])
      expect(skill.path).toContain("process-email/SKILL.md")
    })

    it("parses skill frontmatter with parameters", async () => {
      mockWorkspacePlugins([
        {
          name: "gorgias",
          hasClaudePlugin: true,
          skills: [
            {
              name: "process-ticket",
              frontmatter: [
                "---",
                "name: process-ticket",
                "description: Process a support ticket",
                "category: process",
                "parameters:",
                "  - name: ticket_id",
                "    description: Gorgias ticket ID",
                "---",
              ].join("\n"),
            },
          ],
        },
      ])

      const gorgiasPlugin = makePlugin({ id: "gorgias", name: "Gorgias" })
      await loadPlugins("/fake/workspace", makeImporter({ "plugin.ts": gorgiasPlugin }))

      const plugin = getPlugin("gorgias")
      expect(plugin!.skillManifest).toHaveLength(1)
      const skill = plugin!.skillManifest![0]
      expect(skill.parameters).toEqual([
        { name: "ticket_id", description: "Gorgias ticket ID" },
      ])
    })

    it("skips SKILL.md files with missing required frontmatter fields", async () => {
      mockWorkspacePlugins([
        {
          name: "test-plugin",
          hasClaudePlugin: true,
          skills: [
            {
              name: "incomplete-skill",
              frontmatter: "---\nname: incomplete\n---\n# No description",
            },
            {
              name: "no-frontmatter-skill",
              frontmatter: "# Just content, no frontmatter",
            },
          ],
        },
      ])

      await loadPlugins("/fake/workspace", makeImporter({}))

      const plugin = getPlugin("test-plugin")
      expect(plugin).toBeDefined()
      // Both skills are missing required fields — skillManifest should be empty
      expect(plugin!.skillManifest).toHaveLength(0)
    })
  })

  // ── mixed plugins (data source + skills) ─────────────────────────────────

  describe("mixed plugins", () => {
    it("mixed plugin (plugin.ts + .claude-plugin/) gets hasSkills: true and data source works", async () => {
      mockWorkspacePlugins([
        {
          name: "gmail",
          hasClaudePlugin: true,
          pluginJsonName: "Gmail",
          skills: [
            {
              name: "process-email",
              frontmatter: "---\nname: process-email\ndescription: Process email\n---",
            },
          ],
        },
      ])

      const gmailPlugin = makePlugin({ id: "gmail", name: "Gmail" })
      await loadPlugins("/fake/workspace", makeImporter({ "plugin.ts": gmailPlugin }))

      const plugin = getPlugin("gmail")
      expect(plugin).toBeDefined()
      expect(plugin!.hasSkills).toBe(true)
      expect(plugin!.query).toBeDefined()
      expect(typeof plugin!.query).toBe("function")
      expect(plugin!.skillManifest).toHaveLength(1)
    })
  })

  // ── getSkillPluginPaths ───────────────────────────────────────────────────

  describe("getSkillPluginPaths", () => {
    it("returns absolute paths for all plugins with .claude-plugin/", async () => {
      mockWorkspacePlugins([
        { name: "gmail", hasClaudePlugin: true, skills: [] },
        { name: "slack", hasClaudePlugin: false, skills: [] },
        { name: "context-management", hasClaudePlugin: true, skills: [] },
      ])

      const gmailPlugin = makePlugin({ id: "gmail", name: "Gmail" })
      const slackPlugin = makePlugin({ id: "slack", name: "Slack" })

      // Use path-aware importer: only gmail and slack have plugin.ts; context-management is skills-only
      const importer = async (path: string) => {
        if (path.includes("/gmail/")) return { default: gmailPlugin }
        if (path.includes("/slack/")) return { default: slackPlugin }
        throw Object.assign(new Error(`Module not found: ${path}`), { code: "ENOENT" })
      }

      await loadPlugins("/fake/workspace", importer)

      const paths = getSkillPluginPaths()
      expect(paths).toHaveLength(2) // gmail and context-management
      expect(paths.some((p) => p.includes("/gmail"))).toBe(true)
      expect(paths.some((p) => p.includes("/context-management"))).toBe(true)
      expect(paths.some((p) => p.includes("/slack"))).toBe(false)
    })

    it("returns empty array when no plugins have .claude-plugin/", async () => {
      mockInboxPlugins([])
      await loadPlugins("/fake/workspace")
      expect(getSkillPluginPaths()).toHaveLength(0)
    })

    it("is reset by __resetForTest", async () => {
      mockWorkspacePlugins([
        { name: "gmail", hasClaudePlugin: true, skills: [] },
      ])
      await loadPlugins("/fake/workspace", makeImporter({}))
      expect(getSkillPluginPaths()).toHaveLength(1)

      loadPlugins.__resetForTest?.()
      expect(getSkillPluginPaths()).toHaveLength(0)
    })
  })

  // ── getPluginDir ──────────────────────────────────────────────────────────

  describe("getPluginDir", () => {
    it("returns the directory path for a plugin with .claude-plugin/", async () => {
      mockWorkspacePlugins([
        { name: "gmail", hasClaudePlugin: true, skills: [] },
      ])
      const gmailPlugin = makePlugin({ id: "gmail", name: "Gmail" })
      await loadPlugins("/fake/workspace", makeImporter({ "plugin.ts": gmailPlugin }))

      const dir = getPluginDir("gmail")
      expect(dir).toBeDefined()
      expect(dir).toContain("/gmail")
    })

    it("returns undefined for a plugin without .claude-plugin/", async () => {
      mockInboxPlugins(["slack-plugin.ts"])
      const slack = makePlugin({ id: "slack", name: "Slack" })
      await loadPlugins("/fake/workspace", makeImporter({ "slack-plugin.ts": slack }))

      expect(getPluginDir("slack")).toBeUndefined()
    })

    it("returns undefined for an unknown plugin id", async () => {
      mockInboxPlugins([])
      await loadPlugins("/fake/workspace")
      expect(getPluginDir("nope")).toBeUndefined()
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
