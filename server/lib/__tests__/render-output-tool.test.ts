import { describe, it, expect } from "vitest"
import { buildRenderOutputMcpServer } from "../render-output-tool.js"

describe("buildRenderOutputMcpServer", () => {
  it("returns an MCP server config with type sdk", () => {
    const config = buildRenderOutputMcpServer()
    expect(config.type).toBe("sdk")
    expect(config.name).toBe("render_output")
    expect(config.instance).toBeDefined()
  })
})
