import { describe, it, expect, beforeEach, vi } from "vitest"

process.env.VAULT_SECRET = "aa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b"

// In-memory stores to simulate DB tables
const userCredentials = new Map<string, any>()
const workspaceCredentials = new Map<string, any>()

vi.mock("../../db/pool.js", () => ({
  query: vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes("FROM user_credentials") && sql.includes("WHERE user_email")) {
      const email = params![0] as string
      const results: any[] = []
      for (const [key, row] of userCredentials.entries()) {
        if (key.startsWith(email + ":")) {
          results.push(row)
        }
      }
      results.sort((a, b) => a.integration.localeCompare(b.integration))
      return results
    }
    if (sql.includes("FROM workspace_credentials") && sql.includes("WHERE workspace")) {
      const workspace = params![0] as string
      const results: any[] = []
      for (const [key, row] of workspaceCredentials.entries()) {
        if (key.startsWith(workspace + ":")) {
          results.push(row)
        }
      }
      results.sort((a, b) => a.integration.localeCompare(b.integration))
      return results
    }
    return []
  }),
  queryOne: vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes("FROM user_credentials") && params!.length >= 2) {
      const email = params![0] as string
      const integration = params![1] as string
      return userCredentials.get(`${email}:${integration}`) || undefined
    }
    if (sql.includes("FROM workspace_credentials") && params!.length >= 2) {
      const workspace = params![0] as string
      const integration = params![1] as string
      return workspaceCredentials.get(`${workspace}:${integration}`) || undefined
    }
    return undefined
  }),
  execute: vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes("INSERT INTO user_credentials")) {
      const userEmail = params![0] as string
      const integration = params![1] as string
      const encrypted_token = params![2] as string
      const refresh_token = params![3]
      const scopes = params![4]
      const expires_at = params![5]
      const created_at = params![6] as string
      const updated_at = params![7] as string
      userCredentials.set(`${userEmail}:${integration}`, {
        encrypted_token,
        refresh_token,
        scopes,
        expires_at,
        integration,
        updated_at,
      })
      return { rowCount: 1 }
    }
    if (sql.includes("DELETE FROM user_credentials")) {
      const email = params![0] as string
      const integration = params![1] as string
      userCredentials.delete(`${email}:${integration}`)
      return { rowCount: 1 }
    }
    if (sql.includes("INSERT INTO workspace_credentials")) {
      const workspace = params![0] as string
      const integration = params![1] as string
      const encrypted_token = params![2] as string
      const created_at = params![3] as string
      const updated_at = params![4] as string
      workspaceCredentials.set(`${workspace}:${integration}`, {
        encrypted_token,
        integration,
        updated_at,
      })
      return { rowCount: 1 }
    }
    return { rowCount: 0 }
  }),
}))

const {
  encrypt,
  decrypt,
  storeUserCredential,
  getUserCredential,
  listUserCredentials,
  deleteUserCredential,
  storeWorkspaceCredential,
  getWorkspaceCredential,
  listWorkspaceCredentials,
  resolveCredential,
  seedWorkspaceCredentials,
} = await import("../vault.js")

describe("vault", () => {
  beforeEach(() => {
    userCredentials.clear()
    workspaceCredentials.clear()
  })

  describe("VAULT_SECRET validation", () => {
    it("Scenario: `VAULT_SECRET` validation at first use — throws naming the variable when unset or malformed", () => {
      const original = process.env.VAULT_SECRET
      try {
        delete process.env.VAULT_SECRET
        expect(() => encrypt("x")).toThrow(/VAULT_SECRET/)
        process.env.VAULT_SECRET = "tooshort"
        expect(() => encrypt("x")).toThrow(/VAULT_SECRET/)
        process.env.VAULT_SECRET = "z".repeat(64)
        expect(() => encrypt("x")).toThrow()
      } finally {
        process.env.VAULT_SECRET = original
      }
    })
  })

  describe("encrypt/decrypt", () => {
    it("round-trips a plaintext string", () => {
      const plaintext = "ya29.a0AfH6SMBx_super_secret_token"
      const encrypted = encrypt(plaintext)
      expect(encrypted).not.toBe(plaintext)
      expect(encrypted).toContain(":")
      expect(decrypt(encrypted)).toBe(plaintext)
    })
    it("Scenario: `encrypt()` produces fresh IV per call — produces different ciphertexts for same plaintext (random IV)", () => {
      const a = encrypt("same-token")
      const b = encrypt("same-token")
      expect(a).not.toBe(b)
      expect(decrypt(a)).toBe("same-token")
      expect(decrypt(b)).toBe("same-token")
    })
    it("Scenario: `decrypt()` rejects tampered ciphertext — throws on tampered ciphertext", () => {
      const encrypted = encrypt("secret")
      const parts = encrypted.split(":")
      parts[2] = parts[2]!.slice(0, -2) + "ff"
      expect(() => decrypt(parts.join(":"))).toThrow()
    })
  })

  describe("user credential CRUD", () => {
    const testEmail = "test@hammies.com"
    const integration = "notion"

    it("Scenario: `storeUserCredential` upserts encrypted token + optional refresh token — stores and retrieves a credential", async () => {
      await storeUserCredential(testEmail, integration, { token: "xoxb-test-token", scopes: "read,write" })
      const cred = await getUserCredential(testEmail, integration)
      expect(cred).not.toBeNull()
      expect(cred!.token).toBe("xoxb-test-token")
      expect(cred!.scopes).toBe("read,write")
    })
    it("Scenario: `getUserCredential` returns plaintext token or null — returns null for missing credential", async () => {
      expect(await getUserCredential(testEmail, "nonexistent")).toBeNull()
    })
    it("Scenario: `listUserCredentials` returns metadata only — lists all credentials for a user", async () => {
      await storeUserCredential(testEmail, "notion", { token: "notion-tok" })
      await storeUserCredential(testEmail, "slack", { token: "slack-tok" })
      const list = await listUserCredentials(testEmail)
      expect(list).toHaveLength(2)
      expect(list.map((c) => c.integration).sort()).toEqual(["notion", "slack"])
    })
    it("deletes a credential", async () => {
      await storeUserCredential(testEmail, integration, { token: "to-delete" })
      expect(await getUserCredential(testEmail, integration)).not.toBeNull()
      await deleteUserCredential(testEmail, integration)
      expect(await getUserCredential(testEmail, integration)).toBeNull()
    })
    it("Scenario: `deleteUserCredential` is idempotent — deleting a never-connected integration returns normally", async () => {
      await expect(deleteUserCredential(testEmail, "never-connected")).resolves.toBeUndefined()
      expect(await getUserCredential(testEmail, "never-connected")).toBeNull()
    })
    it("upserts on duplicate (user_email, integration)", async () => {
      await storeUserCredential(testEmail, integration, { token: "old" })
      await storeUserCredential(testEmail, integration, { token: "new" })
      const cred = await getUserCredential(testEmail, integration)
      expect(cred!.token).toBe("new")
    })
  })

  describe("workspace credential CRUD", () => {
    const workspace = "hammies-agent"
    const integration = "air"
    it("Scenario: `storeWorkspaceCredential` upserts a single encrypted token — stores and retrieves a workspace credential", async () => {
      await storeWorkspaceCredential(workspace, integration, "ws-secret-token")
      const token = await getWorkspaceCredential(workspace, integration)
      expect(token).toBe("ws-secret-token")
    })
    it("Scenario: `getWorkspaceCredential` returns the decrypted token or null — returns null for missing workspace credential", async () => {
      expect(await getWorkspaceCredential(workspace, "nonexistent")).toBeNull()
    })
    it("lists all workspace credentials", async () => {
      await storeWorkspaceCredential(workspace, "air", "air-tok")
      await storeWorkspaceCredential(workspace, "shopify", "shop-tok")
      const list = await listWorkspaceCredentials(workspace)
      expect(list).toHaveLength(2)
      expect(list.map((c) => c.integration).sort()).toEqual(["air", "shopify"])
    })
  })

  describe("resolveCredential", () => {
    const email = "resolve@hammies.com"
    const ws = "resolve-ws"

    it("Scenario: User credential takes precedence — returns the user token even when a workspace credential exists", async () => {
      await storeUserCredential(email, "notion", { token: "user-tok" })
      await storeWorkspaceCredential(ws, "notion", "ws-tok")
      expect(await resolveCredential(email, ws, "notion")).toBe("user-tok")
    })

    it("Scenario: Falls back to workspace credential — uses workspace token when the user has no row, null when neither exists", async () => {
      await storeWorkspaceCredential(ws, "slack", "ws-slack")
      expect(await resolveCredential(email, ws, "slack")).toBe("ws-slack")
      expect(await resolveCredential(email, ws, "github")).toBeNull()
    })
  })

  describe("seedWorkspaceCredentials", () => {
    const ws = "seed-ws"

    it("Scenario: First-run seed inserts only missing integrations — inserts new values and never overwrites existing rows", async () => {
      await storeWorkspaceCredential(ws, "notion", "existing-notion")
      await seedWorkspaceCredentials(
        ws,
        { NOTION_API_TOKEN: "env-notion", SHOPIFY_TOKEN: "env-shopify", EMPTY_KEY: "" },
        { NOTION_API_TOKEN: "notion", SHOPIFY_TOKEN: "shopify", EMPTY_KEY: "empty" },
      )
      // Existing notion row untouched
      expect(await getWorkspaceCredential(ws, "notion")).toBe("existing-notion")
      // Missing shopify seeded from env
      expect(await getWorkspaceCredential(ws, "shopify")).toBe("env-shopify")
      // Empty env value not seeded
      expect(await getWorkspaceCredential(ws, "empty")).toBeNull()
    })
  })
})
