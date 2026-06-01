import { describe, it, expect } from "vitest"
import { buildArtifactMcpServer } from "../artifact-tools.js"

// The SDK MCP server exposes registered tools at instance._registeredTools.
// We reach in via a narrow cast — the public surface is just the server config.
function getTools(): Record<string, {
  description: string
  inputSchema: { def?: { shape?: Record<string, unknown> }; shape?: Record<string, unknown> }
  handler: (args: Record<string, unknown>, extra: unknown) => Promise<{ content: { type: string; text: string }[] }>
}> {
  const server = buildArtifactMcpServer()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (server.instance as any)._registeredTools
}

describe("buildArtifactMcpServer", () => {
  it("Scenario: `create_file` and `present_files` are the only artifact tools — registers exactly two tools with the required create_file schema", () => {
    // WHEN the agent SDK is started with the artifact MCP server attached
    // THEN exactly two tools — create_file and present_files — are registered.
    const tools = getTools()
    expect(Object.keys(tools).sort()).toEqual(["create_file", "present_files"])
    // AND create_file requires path and file_text.
    const cf = tools["create_file"]
    const shape = cf.inputSchema.def?.shape ?? cf.inputSchema.shape
    expect(shape).toBeDefined()
    expect(Object.keys(shape!)).toContain("path")
    expect(Object.keys(shape!)).toContain("file_text")
  })

  it("Scenario: Tool descriptions ship the entire artifact authoring contract — create_file description enumerates extensions, imports, and style rules", () => {
    // WHEN the agent reads create_file's tool description
    // THEN it enumerates extensions, available imports, style rules, and the globals.
    const desc = getTools()["create_file"].description
    expect(desc).toContain(".jsx")
    expect(desc).toContain(".html")
    expect(desc).toContain(".md")
    expect(desc).toContain(".svg")
    expect(desc).toContain("@hammies/frontend/components/ui")
    expect(desc).toContain("recharts")
    expect(desc).toContain("lucide-react")
    expect(desc).toContain("bg-background")
    expect(desc).toContain("text-sm")
    expect(desc).toContain("sendAction")
    expect(desc).toContain("saveState")
  })

  it("Scenario: Tool handlers return acknowledgement, not the file contents — create_file echoes path/size/ext only", async () => {
    // WHEN create_file resolves
    // THEN the response is "File created: <path> (<size> chars, .<ext>)" — content not echoed.
    const handler = getTools()["create_file"].handler
    const result = await handler(
      { description: "why", path: "/mnt/user-data/outputs/x.jsx", file_text: "hello" },
      {},
    )
    expect(result.content[0].text).toBe("File created: /mnt/user-data/outputs/x.jsx (5 chars, .jsx)")
    expect(result.content[0].text).not.toContain("hello")
  })
})
