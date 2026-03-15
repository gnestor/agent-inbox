import { createCipheriv, createDecipheriv, randomBytes } from "crypto"
import { getDb } from "../db/schema.js"

const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 16

function getVaultKey(): Buffer {
  const secret = process.env.VAULT_SECRET
  if (!secret || secret.length < 64) {
    throw new Error(
      "VAULT_SECRET must be set (64-char hex string = 32 bytes). " +
      "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    )
  }
  if (!/^[0-9a-f]{64}$/i.test(secret)) {
    throw new Error("VAULT_SECRET must be exactly 64 hex characters")
  }
  return Buffer.from(secret, "hex")
}

export function encrypt(plaintext: string): string {
  const key = getVaultKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  let encrypted = cipher.update(plaintext, "utf8", "hex")
  encrypted += cipher.final("hex")
  const authTag = cipher.getAuthTag()
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`
}

export function decrypt(vaultString: string): string {
  const key = getVaultKey()
  const [ivHex, authTagHex, ciphertext] = vaultString.split(":")
  const iv = Buffer.from(ivHex, "hex")
  const authTag = Buffer.from(authTagHex, "hex")
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  let decrypted = decipher.update(ciphertext, "hex", "utf8")
  decrypted += decipher.final("utf8")
  return decrypted
}

export interface StoredCredential {
  integration: string
  token: string
  refreshToken?: string
  scopes?: string
  expiresAt?: string
}

export function storeUserCredential(
  userEmail: string,
  integration: string,
  cred: { token: string; refreshToken?: string; scopes?: string; expiresAt?: string }
) {
  const db = getDb()
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO user_credentials (user_email, integration, encrypted_token, refresh_token, scopes, expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_email, integration) DO UPDATE SET
       encrypted_token = excluded.encrypted_token,
       refresh_token = excluded.refresh_token,
       scopes = excluded.scopes,
       expires_at = excluded.expires_at,
       updated_at = excluded.updated_at`
  ).run(
    userEmail,
    integration,
    encrypt(cred.token),
    cred.refreshToken ? encrypt(cred.refreshToken) : null,
    cred.scopes || null,
    cred.expiresAt || null,
    now,
    now
  )
}

export function getUserCredential(userEmail: string, integration: string): StoredCredential | null {
  const db = getDb()
  const row = db.prepare(
    "SELECT encrypted_token, refresh_token, scopes, expires_at FROM user_credentials WHERE user_email = ? AND integration = ?"
  ).get(userEmail, integration) as { encrypted_token: string; refresh_token: string | null; scopes: string | null; expires_at: string | null } | undefined
  if (!row) return null
  return {
    integration,
    token: decrypt(row.encrypted_token),
    refreshToken: row.refresh_token ? decrypt(row.refresh_token) : undefined,
    scopes: row.scopes || undefined,
    expiresAt: row.expires_at || undefined,
  }
}

export function listUserCredentials(userEmail: string): Array<{ integration: string; scopes: string | null; expiresAt: string | null; updatedAt: string }> {
  const db = getDb()
  return (db.prepare("SELECT integration, scopes, expires_at, updated_at FROM user_credentials WHERE user_email = ? ORDER BY integration").all(userEmail) as Array<{ integration: string; scopes: string | null; expires_at: string | null; updated_at: string }>)
    .map((row) => ({ integration: row.integration, scopes: row.scopes, expiresAt: row.expires_at, updatedAt: row.updated_at }))
}

export function deleteUserCredential(userEmail: string, integration: string) {
  const db = getDb()
  db.prepare("DELETE FROM user_credentials WHERE user_email = ? AND integration = ?").run(userEmail, integration)
}

export function storeWorkspaceCredential(workspace: string, integration: string, token: string) {
  const db = getDb()
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO workspace_credentials (workspace, integration, encrypted_token, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(workspace, integration) DO UPDATE SET
       encrypted_token = excluded.encrypted_token,
       updated_at = excluded.updated_at`
  ).run(workspace, integration, encrypt(token), now, now)
}

export function getWorkspaceCredential(workspace: string, integration: string): string | null {
  const db = getDb()
  const row = db.prepare("SELECT encrypted_token FROM workspace_credentials WHERE workspace = ? AND integration = ?").get(workspace, integration) as { encrypted_token: string } | undefined
  if (!row) return null
  return decrypt(row.encrypted_token)
}

export function listWorkspaceCredentials(workspace: string): Array<{ integration: string; updatedAt: string }> {
  const db = getDb()
  return (db.prepare("SELECT integration, updated_at FROM workspace_credentials WHERE workspace = ? ORDER BY integration").all(workspace) as Array<{ integration: string; updated_at: string }>)
    .map((row) => ({ integration: row.integration, updatedAt: row.updated_at }))
}
