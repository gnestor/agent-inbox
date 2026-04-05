import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mockPoolQuery = vi.fn()
const mockGetPlugins = vi.fn()

vi.mock("../../db/pool.js", () => ({
  getPool: () => ({ query: mockPoolQuery }),
}))

vi.mock("../plugin-loader.js", () => ({
  getPlugins: () => mockGetPlugins(),
}))

const { runHealthChecks, isHealthy } = await import("../health.js")

describe("runHealthChecks", () => {
  const VALID_SECRET = "a".repeat(64)
  let origSecret: string | undefined

  beforeEach(() => {
    origSecret = process.env.VAULT_SECRET
    process.env.VAULT_SECRET = VALID_SECRET
    mockPoolQuery.mockReset()
    mockGetPlugins.mockReset()
    mockPoolQuery.mockResolvedValue({ rows: [] })
    mockGetPlugins.mockReturnValue([{ id: "gmail" }, { id: "notion" }])
  })

  afterEach(() => {
    if (origSecret !== undefined) process.env.VAULT_SECRET = origSecret
    else delete process.env.VAULT_SECRET
  })

  it("returns ok when all checks pass", async () => {
    const report = await runHealthChecks(["/ws/a"])
    expect(report.database.status).toBe("ok")
    expect(report.vault.status).toBe("ok")
    expect(report.plugins.status).toBe("ok")
    expect(isHealthy(report)).toBe(true)
  })

  it("reports database latency", async () => {
    const report = await runHealthChecks([])
    expect(report.database.latencyMs).toBeTypeOf("number")
    expect(report.database.latencyMs!).toBeGreaterThanOrEqual(0)
  })

  it("reports database error when query fails", async () => {
    mockPoolQuery.mockRejectedValueOnce(new Error("connection refused"))
    const report = await runHealthChecks([])
    expect(report.database.status).toBe("error")
    expect(report.database.error).toContain("connection refused")
    expect(isHealthy(report)).toBe(false)
  })

  it("reports vault error when VAULT_SECRET missing", async () => {
    delete process.env.VAULT_SECRET
    const report = await runHealthChecks([])
    expect(report.vault.status).toBe("error")
    expect(report.vault.error).toContain("not set")
    expect(isHealthy(report)).toBe(false)
  })

  it("reports vault error when VAULT_SECRET wrong length", async () => {
    process.env.VAULT_SECRET = "abc"
    const report = await runHealthChecks([])
    expect(report.vault.status).toBe("error")
    expect(report.vault.error).toContain("64 hex")
  })

  it("reports vault error when VAULT_SECRET has non-hex chars", async () => {
    process.env.VAULT_SECRET = "z".repeat(64)
    const report = await runHealthChecks([])
    expect(report.vault.status).toBe("error")
  })

  it("reports plugin count", async () => {
    mockGetPlugins.mockReturnValue([{ id: "a" }, { id: "b" }, { id: "c" }])
    const report = await runHealthChecks([])
    expect(report.plugins.count).toBe(3)
  })

  it("includes workspaces list", async () => {
    const report = await runHealthChecks(["/ws/a", "/ws/b"])
    expect(report.workspaces.count).toBe(2)
    expect(report.workspaces.paths).toEqual(["/ws/a", "/ws/b"])
  })
})
