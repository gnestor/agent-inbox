import { describe, it, expect, beforeEach, vi } from "vitest"
import Database from "better-sqlite3"

process.env.VAULT_SECRET = "aa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b"

const dbHolder: { db: Database.Database | null } = { db: null }

vi.mock("../../db/schema.js", () => ({
  getDb: () => dbHolder.db!,
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

function createSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      email TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      picture TEXT,
      created_at TEXT NOT NULL,
      last_login_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_credentials (
      user_email TEXT NOT NULL REFERENCES users(email),
      integration TEXT NOT NULL,
      encrypted_token TEXT NOT NULL,
      refresh_token TEXT,
      scopes TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_email, integration)
    );
    CREATE TABLE IF NOT EXISTS workspace_credentials (
      workspace TEXT NOT NULL,
      integration TEXT NOT NULL,
      encrypted_token TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (workspace, integration)
    );
  `)
}

describe("vault", () => {
  beforeEach(() => {
    dbHolder.db = new Database(":memory:")
    createSchema(dbHolder.db)
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
      parts[2] = parts[2].slice(0, -2) + "ff"
      expect(() => decrypt(parts.join(":"))).toThrow()
    })
  })

  describe("user credential CRUD", () => {
    const testEmail = "test@hammies.com"
    const integration = "notion"
    beforeEach(() => {
      const db = dbHolder.db!
      db.prepare("DELETE FROM user_credentials WHERE user_email = ?").run(testEmail)
      db.prepare(
        "INSERT OR IGNORE INTO users (email, name, created_at, last_login_at) VALUES (?, ?, ?, ?)"
      ).run(testEmail, "Test", new Date().toISOString(), new Date().toISOString())
    })
    it("stores and retrieves a credential", () => {
      storeUserCredential(testEmail, integration, { token: "xoxb-test-token", scopes: "read,write" })
      const cred = getUserCredential(testEmail, integration)
      expect(cred).not.toBeNull()
      expect(cred!.token).toBe("xoxb-test-token")
      expect(cred!.scopes).toBe("read,write")
    })
    it("returns null for missing credential", () => {
      expect(getUserCredential(testEmail, "nonexistent")).toBeNull()
    })
    it("lists all credentials for a user", () => {
      storeUserCredential(testEmail, "notion", { token: "notion-tok" })
      storeUserCredential(testEmail, "slack", { token: "slack-tok" })
      const list = listUserCredentials(testEmail)
      expect(list).toHaveLength(2)
      expect(list.map((c) => c.integration).sort()).toEqual(["notion", "slack"])
    })
    it("deletes a credential", () => {
      storeUserCredential(testEmail, integration, { token: "to-delete" })
      expect(getUserCredential(testEmail, integration)).not.toBeNull()
      deleteUserCredential(testEmail, integration)
      expect(getUserCredential(testEmail, integration)).toBeNull()
    })
    it("upserts on duplicate (user_email, integration)", () => {
      storeUserCredential(testEmail, integration, { token: "old" })
      storeUserCredential(testEmail, integration, { token: "new" })
      const cred = getUserCredential(testEmail, integration)
      expect(cred!.token).toBe("new")
    })
  })

  describe("workspace credential CRUD", () => {
    const workspace = "hammies-agent"
    const integration = "air"
    beforeEach(() => {
      const db = dbHolder.db!
      db.prepare("DELETE FROM workspace_credentials WHERE workspace = ?").run(workspace)
    })
    it("stores and retrieves a workspace credential", () => {
      storeWorkspaceCredential(workspace, integration, "ws-secret-token")
      const token = getWorkspaceCredential(workspace, integration)
      expect(token).toBe("ws-secret-token")
    })
    it("returns null for missing workspace credential", () => {
      expect(getWorkspaceCredential(workspace, "nonexistent")).toBeNull()
    })
    it("lists all workspace credentials", () => {
      storeWorkspaceCredential(workspace, "air", "air-tok")
      storeWorkspaceCredential(workspace, "shopify", "shop-tok")
      const list = listWorkspaceCredentials(workspace)
      expect(list).toHaveLength(2)
      expect(list.map((c) => c.integration).sort()).toEqual(["air", "shopify"])
    })
  })
})
