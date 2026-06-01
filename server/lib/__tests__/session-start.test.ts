import { vi, describe, it, expect, beforeEach } from "vitest"

// Capture the options the SDK's query() was called with.
const lastQueryOptions = vi.hoisted(() => ({ current: null as any }))
// Control which messages the iterator yields.
const iteratorMessages = vi.hoisted(() => ({ current: [] as any[] }))

const executeCalls = vi.hoisted(() => ({ list: [] as { sql: string; params: unknown[] }[] }))

vi.mock("../../db/pool.js", () => ({
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => undefined),
  execute: vi.fn(async (sql: string, params: unknown[] = []) => {
    executeCalls.list.push({ sql, params })
    return { rowCount: 1 }
  }),
  withTransaction: vi.fn(async (fn: any) => fn({ query: vi.fn(async () => ({ rows: [] })) })),
}))

vi.mock("../../lib/credentials.js", () => ({
  getAgentEnv: () => ({}),
}))

vi.mock("../../lib/title-generator.js", () => ({
  generateSessionTitle: vi.fn().mockResolvedValue(null),
}))

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn((args: any) => {
    lastQueryOptions.current = args.options
    return {
      [Symbol.asyncIterator]: async function* () {
        for (const m of iteratorMessages.current) yield m
      },
    }
  }),
  tool: vi.fn(),
  createSdkMcpServer: vi.fn(),
}))

const initMsg = { type: "system", subtype: "init", session_id: "start-sess-1" }
const resultMsg = { type: "result", result: "all done" }

describe("startSession SDK invocation", () => {
  beforeEach(() => {
    vi.resetModules()
    lastQueryOptions.current = null
    executeCalls.list = []
    iteratorMessages.current = [initMsg]
  })

  it("Scenario: `startSession` calls the SDK with a fixed tool allowlist and bypassed permissions — passes the allowlist, bypassPermissions, and partial messages", async () => {
    const { startSession } = await import("../session-manager.js")
    await startSession("do a thing", { workspacePath: "/tmp/ws" })

    const opts = lastQueryOptions.current
    expect(opts).not.toBeNull()
    expect(opts.cwd).toBe("/tmp/ws")
    expect(opts.allowedTools).toEqual(["Read", "Grep", "Glob", "Bash", "Write", "Edit", "Skill"])
    expect(opts.permissionMode).toBe("bypassPermissions")
    expect(opts.allowDangerouslySkipPermissions).toBe(true)
    expect(opts.includePartialMessages).toBe(true)
    expect(opts.abortController).toBeInstanceOf(AbortController)
    // render_output + artifact MCP servers are registered.
    expect(Object.keys(opts.mcpServers)).toEqual(expect.arrayContaining(["render_output", "artifact"]))
  })

  it("Scenario: System prompt is `claude_code` preset + `SESSION_INSTRUCTIONS` + optional source context — uses the claude_code preset with appended instructions", async () => {
    const { startSession } = await import("../session-manager.js")
    await startSession("hello", { workspacePath: "/tmp/ws" })

    const sp = lastQueryOptions.current.systemPrompt
    expect(sp.type).toBe("preset")
    expect(sp.preset).toBe("claude_code")
    expect(typeof sp.append).toBe("string")
    expect(sp.append.length).toBeGreaterThan(0)
  })

  it("Scenario: `buildAgentEnv` excludes sensitive vars, optionally injects proxy env — strips ANTHROPIC_API_KEY and VAULT_SECRET from agent env", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-should-not-leak"
    process.env.VAULT_SECRET = "vault-should-not-leak"
    process.env.SAFE_PASSTHROUGH = "ok-to-pass"

    const { startSession } = await import("../session-manager.js")
    await startSession("env check", { workspacePath: "/tmp/ws" })

    const env = lastQueryOptions.current.env as Record<string, string>
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.VAULT_SECRET).toBeUndefined()
    expect(env.SAFE_PASSTHROUGH).toBe("ok-to-pass")

    delete process.env.ANTHROPIC_API_KEY
    delete process.env.VAULT_SECRET
    delete process.env.SAFE_PASSTHROUGH
  })

  it("Scenario: `model` option overrides the SDK default — forwards an explicit model to the SDK", async () => {
    const { startSession } = await import("../session-manager.js")
    await startSession("use haiku", { workspacePath: "/tmp/ws", model: "haiku" })
    expect(lastQueryOptions.current.model).toBe("haiku")
  })

  it("Scenario: `skipDbRecord` + `onEnd` for background jobs — skips the DB row and fires onEnd exactly once", async () => {
    iteratorMessages.current = [initMsg, resultMsg]
    const onEnd = vi.fn()

    const { startSession } = await import("../session-manager.js")
    await startSession("background job", { workspacePath: "/tmp/ws", skipDbRecord: true, onEnd })

    // No sessions row inserted and no status UPDATE issued.
    const inserts = executeCalls.list.filter((c) => c.sql.includes("INSERT INTO sessions"))
    const statusUpdates = executeCalls.list.filter((c) => /UPDATE\s+sessions\s+SET\s+status/i.test(c.sql))
    expect(inserts).toHaveLength(0)
    expect(statusUpdates).toHaveLength(0)

    // Give the background loop a tick to drain and fire onEnd.
    await new Promise((r) => setTimeout(r, 20))
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(onEnd).toHaveBeenCalledWith("start-sess-1", "complete", undefined)
  })

  it("Scenario: `updateSessionStatus` debounces touches at 5 s per session — coalesces rapid touches into a single updated_at write", async () => {
    // Many non-terminal messages in quick succession → touchSession called repeatedly.
    iteratorMessages.current = [
      initMsg,
      { type: "assistant", message: { content: [{ type: "text", text: "a" }] } },
      { type: "assistant", message: { content: [{ type: "text", text: "b" }] } },
      { type: "assistant", message: { content: [{ type: "text", text: "c" }] } },
    ]

    const { startSession } = await import("../session-manager.js")
    await startSession("debounce", { workspacePath: "/tmp/ws" })
    await new Promise((r) => setTimeout(r, 20))

    // touchSession issues `UPDATE sessions SET updated_at = ...` (without status).
    const touchWrites = executeCalls.list.filter(
      (c) => /UPDATE\s+sessions\s+SET\s+updated_at/i.test(c.sql) && !/status/i.test(c.sql),
    )
    // All touches within the 5 s window collapse to at most one DB write.
    expect(touchWrites.length).toBeLessThanOrEqual(1)
  })
})
