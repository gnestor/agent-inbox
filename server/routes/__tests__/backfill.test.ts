import { vi, describe, it, expect, beforeEach } from "vitest"

// --- Mock fs, db pool, and entity extraction so runBackfill is driven in isolation ---

const mockWriteFile = vi.fn(async () => {})
const mockMkdir = vi.fn(async () => {})
const mockQueryOne = vi.fn<(...a: unknown[]) => Promise<unknown>>()
const mockExecute = vi.fn<(...a: unknown[]) => Promise<{ rowCount: number }>>()
const mockExtractEntitiesForItem = vi.fn(async () => {})

vi.mock("fs/promises", () => ({
  writeFile: (...a: unknown[]) => mockWriteFile(...(a as [])),
  mkdir: (...a: unknown[]) => mockMkdir(...(a as [])),
}))
vi.mock("../../db/pool.js", () => ({
  queryOne: (...a: unknown[]) => mockQueryOne(...a),
  execute: (...a: unknown[]) => mockExecute(...a),
}))
vi.mock("../../lib/entity-extractor.js", () => ({
  extractEntitiesForItem: (...a: unknown[]) => mockExtractEntitiesForItem(...(a as [])),
}))
vi.mock("../../lib/plugin-loader.js", () => ({
  getPlugins: vi.fn(() => []),
  getPlugin: vi.fn(() => undefined),
}))
vi.mock("../../lib/plugin-context.js", () => ({
  buildPluginContext: vi.fn(async () => ({})),
  getWorkspaceId: vi.fn(() => "agent"),
  getWorkspacePath: vi.fn(() => "/ws"),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockQueryOne.mockResolvedValue(undefined) // no prior backfill_state row
  mockExecute.mockResolvedValue({ rowCount: 1 })
})

describe("runBackfill", () => {
  it("Scenario: Stage 1 — raw backfill writes one stub per item — query() enumerates items and itemToContext() writes one .md stub each", async () => {
    const { runBackfill } = await import("../backfill.js")

    const plugin = {
      id: "gmail",
      query: vi.fn(async () => ({
        items: [
          { id: "msg-1", title: "Order from Acme" },
          { id: "msg-2", title: "Reply from Caroline" },
        ],
        nextCursor: null,
      })),
      itemToContext: (item: { id: string; title: string }) => `---\nid: ${item.id}\n---\n${item.title}`,
    } as never

    const result = await runBackfill(plugin, "/ws", undefined, "agent")

    // One stub written per enumerated item.
    expect(mockWriteFile).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ processed: 2, total: 2, nextCursor: null })
    // Stubs land under the plugin's context dir, named by item id.
    const writtenPaths = mockWriteFile.mock.calls.map((c) => String(c[0]))
    expect(writtenPaths).toContain("/ws/context/gmail/msg-1.md")
    expect(writtenPaths).toContain("/ws/context/gmail/msg-2.md")
    // Frontmatter (entity-scannable) is present in the written stub.
    expect(String(mockWriteFile.mock.calls[0]![1])).toContain("id: msg-1")
  })
})

describe("backfillRoutes REST surface", () => {
  it("Scenario: Backfill routes drive each pipeline stage — registers raw, re-render, extract, curate-entity, record-discovered, and legacy curate routes", async () => {
    const { backfillRoutes } = await import("../backfill.js")
    // Each pipeline stage has a registered route. Collect method+path pairs.
    const registered = new Set(
      backfillRoutes.routes.map((r) => `${r.method} ${r.path}`),
    )
    expect(registered.has("POST /:pluginId")).toBe(true) // raw backfill
    expect(registered.has("POST /:pluginId/re-render")).toBe(true) // re-render
    expect(registered.has("POST /extract-entities")).toBe(true)
    expect(registered.has("POST /extract-bodies")).toBe(true)
    expect(registered.has("POST /curate-entity/next")).toBe(true)
    expect(registered.has("POST /curate-entity")).toBe(true)
    expect(registered.has("POST /record-discovered")).toBe(true)
    expect(registered.has("POST /curate")).toBe(true) // legacy per-source path
  })
})
