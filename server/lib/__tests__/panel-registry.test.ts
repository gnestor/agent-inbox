import { vi, describe, it, expect, beforeEach } from "vitest"
import type { MutationContext } from "../../../src/types/panels.js"

// ---------------------------------------------------------------------------
// Mock fs/promises
// ---------------------------------------------------------------------------

const fsMock = {
  readdir: vi.fn<() => Promise<string[]>>(),
  readFile: vi.fn<() => Promise<string>>(),
}

vi.mock("node:fs/promises", () => fsMock)

const { loadPanels, getPanelSchemas, getRegisteredTags, executeMutation } =
  await import("../panel-registry.js")

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SAMPLE_PANELS = {
  "github-issue-context": [
    { type: "kv-table", fields: ["title", "state"] },
  ],
  "github-issue-result": [
    { type: "prose", field: "summary", format: "markdown" },
    { type: "action-buttons", actions: [{ label: "Close", mutation: "close-issue" }] },
  ],
}

const sampleCtx: MutationContext = { workspacePath: "/ws", env: {} }

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("panel-registry", () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  // ── loadPanels ────────────────────────────────────────────────────────────

  describe("loadPanels", () => {
    it("results in empty registry when workflows directory does not exist", async () => {
      fsMock.readdir.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }))
      await loadPanels("/fake/workspace")
      expect(getPanelSchemas()).toEqual({})
    })

    it("scans the workflows subdirectory of the given workspace", async () => {
      fsMock.readdir.mockResolvedValue([])
      await loadPanels("/my/workspace")
      expect(fsMock.readdir).toHaveBeenCalledWith(expect.stringContaining("/my/workspace"))
      expect(fsMock.readdir).toHaveBeenCalledWith(expect.stringContaining("workflows"))
    })

    it("registers panels from a valid inbox-panels.json", async () => {
      fsMock.readdir.mockResolvedValue(["github-issues"])
      fsMock.readFile
        .mockResolvedValueOnce(JSON.stringify(SAMPLE_PANELS))  // inbox-panels.json
        .mockRejectedValue(new Error("ENOENT"))                // no mutations file
      await loadPanels("/fake/workspace")
      const schemas = getPanelSchemas()
      expect(schemas["github-issue-context"]).toHaveLength(1)
      expect(schemas["github-issue-result"]).toHaveLength(2)
    })

    it("registers panels from multiple workflow directories", async () => {
      fsMock.readdir.mockResolvedValue(["workflow-a", "workflow-b"])
      const panelsA = { "tag-a": [{ type: "prose", field: "body" }] }
      const panelsB = { "tag-b": [{ type: "kv-table", fields: ["x"] }] }
      fsMock.readFile
        .mockResolvedValueOnce(JSON.stringify(panelsA))
        .mockRejectedValueOnce(new Error("ENOENT"))
        .mockResolvedValueOnce(JSON.stringify(panelsB))
        .mockRejectedValueOnce(new Error("ENOENT"))
      await loadPanels("/fake/workspace")
      const schemas = getPanelSchemas()
      expect(Object.keys(schemas)).toEqual(expect.arrayContaining(["tag-a", "tag-b"]))
    })

    it("skips a workflow directory that has no inbox-panels.json", async () => {
      fsMock.readdir.mockResolvedValue(["no-panels-workflow"])
      fsMock.readFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }))
      await loadPanels("/fake/workspace")
      expect(getPanelSchemas()).toEqual({})
    })

    it("skips a workflow with invalid JSON in inbox-panels.json", async () => {
      fsMock.readdir.mockResolvedValue(["bad-workflow"])
      fsMock.readFile.mockResolvedValueOnce("{ invalid json !!!")
      await loadPanels("/fake/workspace")
      expect(getPanelSchemas()).toEqual({})
    })

    it("loads mutation handlers from inbox-mutations file", async () => {
      fsMock.readdir.mockResolvedValue(["my-workflow"])
      fsMock.readFile.mockResolvedValueOnce(JSON.stringify({ "my-tag": [{ type: "prose", field: "x" }] }))

      const closeIssue = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
      const importer = async () => ({ closeIssue })

      await loadPanels("/fake/workspace", importer)

      // kebab-case mapping: closeIssue → close-issue
      await executeMutation("close-issue", { id: "1" }, sampleCtx)
      expect(closeIssue).toHaveBeenCalledWith({ id: "1" }, sampleCtx)
    })

    it("clears existing panels on repeated calls", async () => {
      // First load
      fsMock.readdir.mockResolvedValueOnce(["wf-a"])
      fsMock.readFile
        .mockResolvedValueOnce(JSON.stringify({ "old-tag": [] }))
        .mockRejectedValueOnce(new Error("ENOENT"))
      await loadPanels("/fake/workspace")
      expect(getRegisteredTags()).toContain("old-tag")

      // Second load with different workflow
      fsMock.readdir.mockResolvedValueOnce(["wf-b"])
      fsMock.readFile
        .mockResolvedValueOnce(JSON.stringify({ "new-tag": [] }))
        .mockRejectedValueOnce(new Error("ENOENT"))
      await loadPanels("/fake/workspace")
      expect(getRegisteredTags()).not.toContain("old-tag")
      expect(getRegisteredTags()).toContain("new-tag")
    })
  })

  // ── getPanelSchemas ───────────────────────────────────────────────────────

  describe("getPanelSchemas", () => {
    it("returns an empty object when nothing is loaded", async () => {
      fsMock.readdir.mockResolvedValue([])
      await loadPanels("/fake/workspace")
      expect(getPanelSchemas()).toEqual({})
    })

    it("returns a plain object (not a Map)", async () => {
      fsMock.readdir.mockResolvedValue([])
      await loadPanels("/fake/workspace")
      const schemas = getPanelSchemas()
      expect(schemas).toBeTypeOf("object")
      expect(schemas).not.toBeInstanceOf(Map)
    })
  })

  // ── getRegisteredTags ────────────────────────────────────────────────────

  describe("getRegisteredTags", () => {
    it("returns the list of registered XML tag names", async () => {
      fsMock.readdir.mockResolvedValue(["wf"])
      fsMock.readFile
        .mockResolvedValueOnce(JSON.stringify({ "tag-x": [], "tag-y": [] }))
        .mockRejectedValueOnce(new Error("ENOENT"))
      await loadPanels("/fake/workspace")
      expect(getRegisteredTags()).toEqual(expect.arrayContaining(["tag-x", "tag-y"]))
    })
  })

  // ── executeMutation ───────────────────────────────────────────────────────

  describe("executeMutation", () => {
    it("throws for an unregistered action", async () => {
      fsMock.readdir.mockResolvedValue([])
      await loadPanels("/fake/workspace")
      await expect(executeMutation("unknown-action", {}, sampleCtx)).rejects.toThrow(
        /unknown-action/,
      )
    })

    it("passes payload and context to the handler", async () => {
      fsMock.readdir.mockResolvedValue(["wf"])
      fsMock.readFile.mockResolvedValueOnce(JSON.stringify({ "t": [] }))

      const handler = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
      await loadPanels("/fake/workspace", async () => ({ myHandler: handler }))

      const payload = { foo: "bar" }
      const ctx = { workspacePath: "/ws2", env: { TOKEN: "abc" } }
      await executeMutation("my-handler", payload, ctx)
      expect(handler).toHaveBeenCalledWith(payload, ctx)
    })
  })
})
