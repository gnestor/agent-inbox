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
} = await import("../vault.js")

describe("vault", () => {
  beforeEach(() => {
    userCredentials.clear()
    workspaceCredentials.clear()
  })

  describe("encrypt/decrypt", () => {
    it("round-trips a plaintext string", () => {
      const plaintext = "ya29.a0AfH6SMBx_super_secret_token"
      const encrypted = encrypt(plaintext)
      expect(encrypted).not.toBe(plaintext)
      expect(encrypted).toContain(":")
      expect(decrypt(encrypted)).toBe(plaintext)
    })
    it("produces different ciphertexts for same plaintext (random IV)", () => {
      const a = encrypt("same-token")
      const b = encrypt("same-token")
      expect(a).not.toBe(b)
      expect(decrypt(a)).toBe("same-token")
      expect(decrypt(b)).toBe("same-token")
    })
    it("throws on tampered ciphertext", () => {
      const encrypted = encrypt("secret")
      const parts = encrypted.split(":")
      parts[2] = parts[2]!.slice(0, -2) + "ff"
      expect(() => decrypt(parts.join(":"))).toThrow()
    })
  })

  describe("user credential CRUD", () => {
    const testEmail = "test@hammies.com"
    const integration = "notion"

    it("stores and retrieves a credential", async () => {
      await storeUserCredential(testEmail, integration, { token: "xoxb-test-token", scopes: "read,write" })
      const cred = await getUserCredential(testEmail, integration)
      expect(cred).not.toBeNull()
      expect(cred!.token).toBe("xoxb-test-token")
      expect(cred!.scopes).toBe("read,write")
    })
    it("returns null for missing credential", async () => {
      expect(await getUserCredential(testEmail, "nonexistent")).toBeNull()
    })
    it("lists all credentials for a user", async () => {
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
    it("stores and retrieves a workspace credential", async () => {
      await storeWorkspaceCredential(workspace, integration, "ws-secret-token")
      const token = await getWorkspaceCredential(workspace, integration)
      expect(token).toBe("ws-secret-token")
    })
    it("returns null for missing workspace credential", async () => {
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
})
