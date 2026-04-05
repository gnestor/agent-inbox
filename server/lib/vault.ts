import { createCipheriv, createDecipheriv, randomBytes } from "crypto"
import { execute, query, queryOne } from "../db/pool.js"
import { createLogger } from "./logger.js"

const log = createLogger("vault")

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
  const parts = vaultString.split(":")
  const ivHex = parts[0] ?? ""
  const authTagHex = parts[1] ?? ""
  const ciphertext = parts[2] ?? ""
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

export async function storeUserCredential(
  userEmail: string,
  integration: string,
  cred: { token: string; refreshToken?: string; scopes?: string; expiresAt?: string }
) {
  const now = new Date().toISOString()
  await execute(
    `INSERT INTO user_credentials (user_email, integration, encrypted_token, refresh_token, scopes, expires_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT(user_email, integration) DO UPDATE SET
       encrypted_token = EXCLUDED.encrypted_token,
       refresh_token = EXCLUDED.refresh_token,
       scopes = EXCLUDED.scopes,
       expires_at = EXCLUDED.expires_at,
       updated_at = EXCLUDED.updated_at`,
    [
      userEmail,
      integration,
      encrypt(cred.token),
      cred.refreshToken ? encrypt(cred.refreshToken) : null,
      cred.scopes || null,
      cred.expiresAt || null,
      now,
      now,
    ],
  )
}

export async function getUserCredential(userEmail: string, integration: string): Promise<StoredCredential | null> {
  const row = await queryOne<{
    encrypted_token: string
    refresh_token: string | null
    scopes: string | null
    expires_at: string | null
  }>(
    "SELECT encrypted_token, refresh_token, scopes, expires_at FROM user_credentials WHERE user_email = $1 AND integration = $2",
    [userEmail, integration],
  )
  if (!row) return null
  return {
    integration,
    token: decrypt(row.encrypted_token),
    refreshToken: row.refresh_token ? decrypt(row.refresh_token) : undefined,
    scopes: row.scopes || undefined,
    expiresAt: row.expires_at || undefined,
  }
}

export async function listUserCredentials(userEmail: string): Promise<Array<{ integration: string; scopes: string | null; expiresAt: string | null; updatedAt: string }>> {
  const rows = await query<{
    integration: string
    scopes: string | null
    expires_at: string | null
    updated_at: string
  }>(
    "SELECT integration, scopes, expires_at, updated_at FROM user_credentials WHERE user_email = $1 ORDER BY integration",
    [userEmail],
  )
  return rows.map((row) => ({
    integration: row.integration,
    scopes: row.scopes,
    expiresAt: row.expires_at,
    updatedAt: row.updated_at,
  }))
}

export async function deleteUserCredential(userEmail: string, integration: string) {
  await execute(
    "DELETE FROM user_credentials WHERE user_email = $1 AND integration = $2",
    [userEmail, integration],
  )
}

export async function storeWorkspaceCredential(workspace: string, integration: string, token: string) {
  const now = new Date().toISOString()
  await execute(
    `INSERT INTO workspace_credentials (workspace, integration, encrypted_token, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT(workspace, integration) DO UPDATE SET
       encrypted_token = EXCLUDED.encrypted_token,
       updated_at = EXCLUDED.updated_at`,
    [workspace, integration, encrypt(token), now, now],
  )
}

export async function getWorkspaceCredential(workspace: string, integration: string): Promise<string | null> {
  const row = await queryOne<{ encrypted_token: string }>(
    "SELECT encrypted_token FROM workspace_credentials WHERE workspace = $1 AND integration = $2",
    [workspace, integration],
  )
  if (!row) return null
  return decrypt(row.encrypted_token)
}

export async function listWorkspaceCredentials(workspace: string): Promise<Array<{ integration: string; updatedAt: string }>> {
  const rows = await query<{ integration: string; updated_at: string }>(
    "SELECT integration, updated_at FROM workspace_credentials WHERE workspace = $1 ORDER BY integration",
    [workspace],
  )
  return rows.map((row) => ({ integration: row.integration, updatedAt: row.updated_at }))
}

/**
 * Resolve a credential for a given user + integration.
 * Priority: user-scoped > workspace-scoped.
 */
export async function resolveCredential(
  userEmail: string,
  workspace: string,
  integration: string,
): Promise<string | null> {
  const userCred = await getUserCredential(userEmail, integration)
  if (userCred) return userCred.token

  return getWorkspaceCredential(workspace, integration)
}

/**
 * Auto-seed workspace credentials from the workspace .env file.
 * Only inserts credentials that don't already exist in the vault.
 */
export async function seedWorkspaceCredentials(
  workspaceName: string,
  envVars: Record<string, string>,
  envToIntegration: Record<string, string>,
) {
  const existing = new Set((await listWorkspaceCredentials(workspaceName)).map((c) => c.integration))

  let count = 0
  for (const [envKey, value] of Object.entries(envVars)) {
    const integration = envToIntegration[envKey]
    if (!integration || !value || existing.has(integration)) continue

    await storeWorkspaceCredential(workspaceName, integration, value)
    log.info("Seeded workspace credential from env", { envKey, workspace: workspaceName, integration })
    count++
  }

  if (count > 0) {
    log.info("Seeded workspace credentials from .env", { count, workspace: workspaceName })
  }
}
