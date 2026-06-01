import { vi, describe, it, expect, beforeEach } from "vitest"
import { HTTPException } from "hono/http-exception"
import type { Context } from "hono"
import type { AppBindings } from "../workspace-context.js"

// --- Mock the vault + credentials helpers used by buildPluginContext ---

const mockGetUserCredential = vi.fn<(...a: unknown[]) => Promise<unknown>>()
const mockRefreshGoogleToken = vi.fn<(...a: unknown[]) => Promise<string>>()

vi.mock("../vault.js", () => ({
  getUserCredential: (...a: unknown[]) => mockGetUserCredential(...a),
}))
vi.mock("../credentials.js", () => ({
  refreshGoogleToken: (...a: unknown[]) => mockRefreshGoogleToken(...a),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

function fakeContext(vars: Record<string, unknown>) {
  return { get: (k: string) => vars[k] }
}

describe("buildPluginContext", () => {
  it("Scenario: `buildPluginContext` injects credentials lazily per integration — refreshes google tokens, returns refresh token for others", async () => {
    const { buildPluginContext } = await import("../plugin-context.js")
    const ctx = await buildPluginContext(fakeContext({ userEmail: "alice@example.com" }))
    expect(ctx.userEmail).toBe("alice@example.com")

    // google → refreshed access token
    mockGetUserCredential.mockResolvedValueOnce({ refreshToken: "g-refresh" })
    mockRefreshGoogleToken.mockResolvedValueOnce("g-access")
    const google = await ctx.getCredential!("google")
    expect(google).toBe("g-access")
    expect(mockRefreshGoogleToken).toHaveBeenCalledWith("g-refresh")

    // other integration → stored refresh token, no refresh call
    mockGetUserCredential.mockResolvedValueOnce({ refreshToken: "notion-tok" })
    const notion = await ctx.getCredential!("notion")
    expect(notion).toBe("notion-tok")

    // missing credential → null
    mockGetUserCredential.mockResolvedValueOnce(undefined)
    expect(await ctx.getCredential!("slack")).toBeNull()
  })
})

describe("requireAdmin (workspace-context)", () => {
  it("Scenario: `requireAdmin` enforces admin role on workspace-mutating routes — throws 403 unless role is admin", async () => {
    const { requireAdmin } = await import("../workspace-context.js")

    const adminCtx = { get: () => ({ id: "ws", name: "n", path: "/p", role: "admin" }) } as unknown as Context<AppBindings>
    expect(() => requireAdmin(adminCtx)).not.toThrow()

    const memberCtx = { get: () => ({ id: "ws", name: "n", path: "/p", role: "member" }) } as unknown as Context<AppBindings>
    expect(() => requireAdmin(memberCtx)).toThrow(HTTPException)

    const noWsCtx = { get: () => undefined } as unknown as Context<AppBindings>
    expect(() => requireAdmin(noWsCtx)).toThrow("Admin access required")
  })
})
