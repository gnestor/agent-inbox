import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import corePlugin from "../plugin.js"

const here = dirname(fileURLToPath(import.meta.url))
const coreDir = join(here, "..")

function skillDescription(skill: string): string {
  return readFileSync(join(coreDir, "skills", skill, "SKILL.md"), "utf8")
}

describe("core plugin", () => {
  describe("Plugin shape", () => {
    it("Scenario: Core is a skills-only plugin with no tab", () => {
      expect(corePlugin.id).toBe("core")
      expect(corePlugin.name).toBe("Core")
      expect(corePlugin.icon).toBe("Cog")
      expect(corePlugin.hasSkills).toBe(true)
      // No fieldSchema / query / itemToContext → invisible to the tab list.
      expect(corePlugin.fieldSchema).toBeUndefined()
      expect(corePlugin.query).toBeUndefined()
      expect(corePlugin.itemToContext).toBeUndefined()
      // GET /api/plugins filters p.fieldSchema?.length > 0 — core is excluded.
      expect((corePlugin.fieldSchema?.length ?? 0) > 0).toBe(false)
    })

    it("Scenario: Core plugin is a built-in — ships under packages/inbox/plugins/core", () => {
      // The built-in loader scans packages/inbox/plugins/* for plugin.ts; core
      // lives there and is registered as a builtin (survives workspace reloads).
      expect(existsSync(join(coreDir, "plugin.ts"))).toBe(true)
      expect(existsSync(join(coreDir, ".claude-plugin", "plugin.json"))).toBe(true)
    })
  })

  describe("Skills bundle", () => {
    it("Scenario: `plugin-creator` activates on plugin-creation phrasing", () => {
      expect(existsSync(join(coreDir, "skills", "plugin-creator", "SKILL.md"))).toBe(true)
      const desc = skillDescription("plugin-creator")
      expect(desc).toContain('create a plugin for X')
      expect(desc).toContain('connect X to inbox')
      expect(desc).toContain('build an inbox plugin for X')
    })

    it("Scenario: `render-output` activates when the agent needs visual output", () => {
      expect(existsSync(join(coreDir, "skills", "render-output", "SKILL.md"))).toBe(true)
      const desc = skillDescription("render-output")
      expect(desc).toContain("create_file")
      expect(desc).toContain("present_files")
      expect(desc).toContain("render_output")
    })
  })

  describe("Hooks manifest", () => {
    it("Scenario: Empty hooks manifest is a deliberate placeholder", () => {
      const manifest = JSON.parse(readFileSync(join(coreDir, "hooks", "hooks.json"), "utf8"))
      expect(manifest).toEqual({ description: "Core plugin hooks", hooks: {} })
    })
  })
})
