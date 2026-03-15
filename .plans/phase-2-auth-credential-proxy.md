# Phase 2: Multi-User Auth + Credential Proxy — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-workspace `.env` credential model with a per-user credential vault and transparent HTTPS credential proxy, so each user connects their own OAuth accounts and raw tokens never leak into agent subprocesses or LLM context.

**Architecture:** Two new DB tables (`user_credentials`, `workspace_credentials`) with AES-256-GCM encryption. A localhost HTTPS proxy inside the Hono process intercepts outbound API calls from agent subprocesses and injects `Authorization` headers from the vault. OAuth connection flows let users link their own accounts. A settings UI shows connected integrations.

**Tech Stack:** Hono routes, better-sqlite3, Node `crypto` (AES-256-GCM), `node:http` + `node:tls` (MITM proxy), React 19, TanStack Query, shadcn UI components

---

## File Structure

```
server/
├── db/
│   └── schema.ts                    — MODIFY: add user_credentials, workspace_credentials tables
├── lib/
│   ├── vault.ts                     — CREATE: encrypt/decrypt, CRUD for credential vault
│   ├── credential-proxy.ts          — CREATE: localhost HTTPS MITM proxy
│   ├── credential-proxy-ca.ts       — CREATE: self-signed CA generation + cert cache
│   ├── credentials.ts               — MODIFY: deprecate getAgentEnv(), add getCredentialForUser()
│   ├── session-manager.ts           — MODIFY: buildAgentEnv() → use proxy env vars
│   ├── auth.ts                      — MODIFY: add getSessionUser() helper returning user_email
│   └── __tests__/
│       ├── vault.test.ts            — CREATE: encrypt/decrypt + CRUD tests
│       ├── credential-proxy.test.ts — CREATE: proxy interception tests
│       └── credential-proxy-ca.test.ts — CREATE: CA/cert generation tests
├── routes/
│   ├── connections.ts               — CREATE: OAuth connect/disconnect + list routes
│   └── auth.ts                      — MODIFY: expose user_email on session endpoint
src/
├── api/
│   └── client.ts                    — MODIFY: add connections API functions
├── components/
│   └── settings/
│       ├── IntegrationsPage.tsx      — CREATE: connect/disconnect integrations UI
│       └── IntegrationCard.tsx       — CREATE: single integration card component
├── hooks/
│   └── use-connections.ts           — CREATE: TanStack Query hooks for connections
├── types/
│   └── index.ts                     — MODIFY: add Connection, Integration types
```

---

## Chunk 1: Credential Vault (DB + Encryption)

The vault stores encrypted OAuth tokens per user and per workspace. All encryption uses AES-256-GCM with a `VAULT_SECRET` environment variable (32-byte hex key).

### Task 1: Add vault tables to DB schema

**Files:**
- Modify: `server/db/schema.ts`

- [ ] **Step 1: Add user_credentials and workspace_credentials tables**

In `initializeDatabase()`, add the new table definitions after the existing `CREATE TABLE` statements:

```typescript
// After the api_cache CREATE TABLE block, add:

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
```

- [ ] **Step 2: Run tests**

Run: `cd packages/inbox && npm run test:ci`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add server/db/schema.ts
git commit -m "feat: add user_credentials and workspace_credentials tables"
```

### Task 2: Vault encryption module

**Files:**
- Create: `server/lib/vault.ts`
- Create: `server/lib/__tests__/vault.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// server/lib/__tests__/vault.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import { getDb } from "../../db/schema.js"

// Set VAULT_SECRET before importing vault
process.env.VAULT_SECRET = "aa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b"

import {
  encrypt,
  decrypt,
  storeUserCredential,
  getUserCredential,
  listUserCredentials,
  deleteUserCredential,
  storeWorkspaceCredential,
  getWorkspaceCredential,
  listWorkspaceCredentials,
} from "../vault.js"

describe("vault", () => {
  describe("encrypt/decrypt", () => {
    it("round-trips a plaintext string", () => {
      const plaintext = "ya29.a0AfH6SMBx_super_secret_token"
      const encrypted = encrypt(plaintext)
      expect(encrypted).not.toBe(plaintext)
      expect(encrypted).toContain(":") // iv:authTag:ciphertext format
      expect(decrypt(encrypted)).toBe(plaintext)
    })

    it("produces different ciphertexts for the same plaintext (random IV)", () => {
      const plaintext = "same-token"
      const a = encrypt(plaintext)
      const b = encrypt(plaintext)
      expect(a).not.toBe(b)
      expect(decrypt(a)).toBe(plaintext)
      expect(decrypt(b)).toBe(plaintext)
    })

    it("throws on tampered ciphertext", () => {
      const encrypted = encrypt("secret")
      const parts = encrypted.split(":")
      parts[2] = parts[2].slice(0, -2) + "ff" // tamper ciphertext
      expect(() => decrypt(parts.join(":"))).toThrow()
    })
  })

  describe("user credential CRUD", () => {
    const testEmail = "test@hammies.com"
    const integration = "notion"

    beforeEach(() => {
      const db = getDb()
      db.prepare("DELETE FROM user_credentials WHERE user_email = ?").run(testEmail)
      // Ensure user exists for FK
      db.prepare(
        "INSERT OR IGNORE INTO users (email, name, created_at, last_login_at) VALUES (?, ?, ?, ?)"
      ).run(testEmail, "Test", new Date().toISOString(), new Date().toISOString())
    })

    it("stores and retrieves a credential", () => {
      storeUserCredential(testEmail, integration, {
        token: "xoxb-test-token",
        scopes: "read,write",
      })

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
      const db = getDb()
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/inbox && npx vitest run server/lib/__tests__/vault.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write the vault implementation**

```typescript
// server/lib/vault.ts
import { createCipheriv, createDecipheriv, randomBytes } from "crypto"
import { getDb } from "../db/schema.js"

const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16

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

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns "iv:authTag:ciphertext" (all hex-encoded).
 */
export function encrypt(plaintext: string): string {
  const key = getVaultKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)

  let encrypted = cipher.update(plaintext, "utf8", "hex")
  encrypted += cipher.final("hex")
  const authTag = cipher.getAuthTag()

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`
}

/**
 * Decrypt a vault string ("iv:authTag:ciphertext") back to plaintext.
 */
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

// --- User Credentials ---

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
  cred: {
    token: string
    refreshToken?: string
    scopes?: string
    expiresAt?: string
  }
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

export function getUserCredential(
  userEmail: string,
  integration: string
): StoredCredential | null {
  const db = getDb()
  const row = db
    .prepare(
      "SELECT encrypted_token, refresh_token, scopes, expires_at FROM user_credentials WHERE user_email = ? AND integration = ?"
    )
    .get(userEmail, integration) as
    | { encrypted_token: string; refresh_token: string | null; scopes: string | null; expires_at: string | null }
    | undefined

  if (!row) return null

  return {
    integration,
    token: decrypt(row.encrypted_token),
    refreshToken: row.refresh_token ? decrypt(row.refresh_token) : undefined,
    scopes: row.scopes || undefined,
    expiresAt: row.expires_at || undefined,
  }
}

export function listUserCredentials(userEmail: string): Array<{
  integration: string
  scopes: string | null
  expiresAt: string | null
  updatedAt: string
}> {
  const db = getDb()
  return db
    .prepare(
      "SELECT integration, scopes, expires_at, updated_at FROM user_credentials WHERE user_email = ? ORDER BY integration"
    )
    .all(userEmail) as Array<{
      integration: string
      scopes: string | null
      expires_at: string | null
      updated_at: string
    }>
    // Normalize column names to camelCase
    .map((row) => ({
      integration: row.integration,
      scopes: row.scopes,
      expiresAt: row.expires_at,
      updatedAt: row.updated_at,
    }))
}

export function deleteUserCredential(userEmail: string, integration: string) {
  const db = getDb()
  db.prepare("DELETE FROM user_credentials WHERE user_email = ? AND integration = ?").run(
    userEmail,
    integration
  )
}

// --- Workspace Credentials ---

export function storeWorkspaceCredential(
  workspace: string,
  integration: string,
  token: string
) {
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

export function getWorkspaceCredential(
  workspace: string,
  integration: string
): string | null {
  const db = getDb()
  const row = db
    .prepare(
      "SELECT encrypted_token FROM workspace_credentials WHERE workspace = ? AND integration = ?"
    )
    .get(workspace, integration) as { encrypted_token: string } | undefined

  if (!row) return null
  return decrypt(row.encrypted_token)
}

export function listWorkspaceCredentials(workspace: string): Array<{
  integration: string
  updatedAt: string
}> {
  const db = getDb()
  return db
    .prepare(
      "SELECT integration, updated_at FROM workspace_credentials WHERE workspace = ? ORDER BY integration"
    )
    .all(workspace) as Array<{ integration: string; updated_at: string }>
    .map((row) => ({
      integration: row.integration,
      updatedAt: row.updated_at,
    }))
}

/**
 * Resolve a credential for a given user + integration.
 * Priority: user-scoped > workspace-scoped.
 */
export function resolveCredential(
  userEmail: string,
  workspace: string,
  integration: string
): string | null {
  const userCred = getUserCredential(userEmail, integration)
  if (userCred) return userCred.token

  return getWorkspaceCredential(workspace, integration)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/inbox && npx vitest run server/lib/__tests__/vault.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/lib/vault.ts server/lib/__tests__/vault.test.ts
git commit -m "feat: add credential vault with AES-256-GCM encryption"
```

---

## Chunk 2: Credential Proxy (HTTPS MITM)

A localhost HTTPS proxy that intercepts outbound requests from agent subprocesses, looks up the calling user's credentials from the vault, and injects `Authorization` headers. The agent subprocess receives `HTTPS_PROXY` (with the session token encoded in the proxy URL's userinfo) and `NODE_EXTRA_CA_CERTS` — never raw tokens. HTTP clients automatically send the userinfo as a `Proxy-Authorization` header on CONNECT requests.

### Task 3: Self-signed CA generation

**Files:**
- Create: `server/lib/credential-proxy-ca.ts`
- Create: `server/lib/__tests__/credential-proxy-ca.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// server/lib/__tests__/credential-proxy-ca.test.ts
import { describe, it, expect } from "vitest"
import { generateCA, generateCertForHost } from "../credential-proxy-ca.js"

describe("credential-proxy-ca", () => {
  let ca: { cert: string; key: string }

  it("generates a CA certificate and key", () => {
    ca = generateCA()
    expect(ca.cert).toContain("-----BEGIN CERTIFICATE-----")
    expect(ca.key).toContain("-----BEGIN")
  })

  it("generates a host certificate signed by the CA", () => {
    ca = generateCA()
    const hostCert = generateCertForHost("api.notion.com", ca)
    expect(hostCert.cert).toContain("-----BEGIN CERTIFICATE-----")
    expect(hostCert.key).toContain("-----BEGIN")
    // Host cert should be different from CA cert
    expect(hostCert.cert).not.toBe(ca.cert)
  })

  it("caches host certificates for the same host", () => {
    ca = generateCA()
    const cert1 = generateCertForHost("api.notion.com", ca)
    const cert2 = generateCertForHost("api.notion.com", ca)
    expect(cert1.cert).toBe(cert2.cert)
  })

  it("generates different certificates for different hosts", () => {
    ca = generateCA()
    const cert1 = generateCertForHost("api.notion.com", ca)
    const cert2 = generateCertForHost("api.github.com", ca)
    expect(cert1.cert).not.toBe(cert2.cert)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/inbox && npx vitest run server/lib/__tests__/credential-proxy-ca.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write the CA module**

This uses the `node:crypto` `X509Certificate` and `generateKeyPairSync` APIs available in Node 20+. For self-signed CA generation without external dependencies, we use the `@peculiar/x509` library (pure JS, no native deps) or a simpler approach with `node-forge`. However, to keep dependencies minimal, we use `node:child_process` to call `openssl` which is available on macOS.

**Alternative (no openssl):** Use the `selfsigned` npm package (tiny, pure JS). Add it as a dependency.

```bash
cd packages/inbox && npm install selfsigned
```

```typescript
// server/lib/credential-proxy-ca.ts
import selfsigned from "selfsigned"
import { writeFileSync, mkdtempSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

interface CertKeyPair {
  cert: string
  key: string
}

let cachedCA: CertKeyPair | null = null
const hostCertCache = new Map<string, CertKeyPair>()

/**
 * Generate a self-signed CA certificate for the credential proxy.
 * The CA is used to sign per-host certificates so the agent subprocess
 * trusts the MITM proxy via NODE_EXTRA_CA_CERTS.
 */
export function generateCA(): CertKeyPair {
  if (cachedCA) return cachedCA

  const attrs = [{ name: "commonName", value: "Inbox Credential Proxy CA" }]
  const pems = selfsigned.generate(attrs, {
    days: 3650,
    keySize: 2048,
    extensions: [
      { name: "basicConstraints", cA: true, critical: true },
      {
        name: "keyUsage",
        keyCertSign: true,
        cRLSign: true,
        critical: true,
      },
    ],
  })

  cachedCA = { cert: pems.cert, key: pems.private }
  return cachedCA
}

/**
 * Generate a TLS certificate for a specific host, signed by our CA.
 * Certificates are cached per-host for the lifetime of the process.
 */
export function generateCertForHost(
  host: string,
  ca: CertKeyPair
): CertKeyPair {
  const cached = hostCertCache.get(host)
  if (cached) return cached

  const attrs = [{ name: "commonName", value: host }]
  const pems = selfsigned.generate(attrs, {
    days: 365,
    keySize: 2048,
    extensions: [
      {
        name: "subjectAltName",
        altNames: [{ type: 2, value: host }], // DNS name
      },
    ],
    // Sign with our CA
    ca: { key: ca.key, cert: ca.cert },
  } as any)

  const pair = { cert: pems.cert, key: pems.private }
  hostCertCache.set(host, pair)
  return pair
}

/**
 * Write the CA cert to a temp file and return the path.
 * Used for NODE_EXTRA_CA_CERTS in agent subprocesses.
 */
export function writeCACertFile(): string {
  const ca = generateCA()
  const dir = mkdtempSync(join(tmpdir(), "inbox-proxy-ca-"))
  const certPath = join(dir, "ca.pem")
  writeFileSync(certPath, ca.cert)
  return certPath
}

/** Reset caches — for testing only */
export function _resetCaches() {
  cachedCA = null
  hostCertCache.clear()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/inbox && npx vitest run server/lib/__tests__/credential-proxy-ca.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/lib/credential-proxy-ca.ts server/lib/__tests__/credential-proxy-ca.test.ts package.json package-lock.json
git commit -m "feat: add self-signed CA generation for credential proxy"
```

### Task 4: HTTPS credential proxy

**Files:**
- Create: `server/lib/credential-proxy.ts`
- Create: `server/lib/__tests__/credential-proxy.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// server/lib/__tests__/credential-proxy.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest"

// Vault secret for tests
process.env.VAULT_SECRET = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b"

import { createCredentialProxy, INTERCEPTED_HOSTS, type CredentialProxy } from "../credential-proxy.js"

describe("credential-proxy", () => {
  let proxy: CredentialProxy

  it("INTERCEPTED_HOSTS includes expected API hosts", () => {
    expect(INTERCEPTED_HOSTS).toContain("api.notion.com")
    expect(INTERCEPTED_HOSTS).toContain("api.github.com")
    expect(INTERCEPTED_HOSTS).toContain("slack.com")
  })

  it("creates a proxy and returns port + CA cert path", async () => {
    proxy = await createCredentialProxy({
      resolveToken: async (_sessionToken, _host) => null,
    })
    expect(proxy.port).toBeGreaterThan(0)
    expect(proxy.caCertPath).toContain("ca.pem")
    await proxy.close()
  })

  it("getProxyEnv returns the expected env vars", async () => {
    proxy = await createCredentialProxy({
      resolveToken: async () => null,
    })
    const env = proxy.getProxyEnv("test-session-token")
    expect(env.HTTPS_PROXY).toBe(`http://test-session-token@127.0.0.1:${proxy.port}`)
    expect(env.NODE_EXTRA_CA_CERTS).toBe(proxy.caCertPath)
    expect(env.NODE_USE_ENV_PROXY).toBe("1")
    // Session token is embedded in proxy URL userinfo, not a separate env var
    expect(env.INBOX_SESSION_TOKEN).toBeUndefined()
    // Should NOT contain raw tokens
    expect(env.NOTION_API_TOKEN).toBeUndefined()
    expect(env.GOOGLE_REFRESH_TOKEN).toBeUndefined()
    await proxy.close()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/inbox && npx vitest run server/lib/__tests__/credential-proxy.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write the credential proxy**

The proxy works as follows:
1. Agent subprocess sends HTTPS requests through `HTTPS_PROXY` (HTTP CONNECT tunnel)
2. For intercepted hosts (Notion, Shopify, Slack, GitHub), the proxy terminates TLS using a per-host cert signed by our CA, reads the request, injects the `Authorization` header from the vault, then forwards to the real server
3. For non-intercepted hosts, the proxy tunnels the connection transparently (normal CONNECT proxy)

```typescript
// server/lib/credential-proxy.ts
import { createServer, type Server, type IncomingMessage } from "node:http"
import { connect as tlsConnect, createServer as createTlsServer } from "node:tls"
import { Socket } from "node:net"
import { generateCA, generateCertForHost, writeCACertFile } from "./credential-proxy-ca.js"

/**
 * Hosts where the proxy will intercept and inject credentials.
 * Requests to other hosts pass through as a transparent tunnel.
 */
export const INTERCEPTED_HOSTS = [
  "api.notion.com",
  "api.github.com",
  "slack.com",
  "api.slack.com",
  "hooks.slack.com",
  "shopify.com",       // *.shopify.com via endsWith check
  "googleapis.com",    // *.googleapis.com via endsWith check
  "api.air.inc",
]

function shouldIntercept(host: string): boolean {
  return INTERCEPTED_HOSTS.some(
    (h) => host === h || host.endsWith(`.${h}`)
  )
}

/**
 * Map intercepted host to the integration name used in the vault.
 */
function hostToIntegration(host: string): string {
  if (host === "api.notion.com") return "notion"
  if (host === "api.github.com") return "github"
  if (host.includes("slack.com")) return "slack"
  if (host.includes("shopify.com")) return "shopify"
  if (host.includes("googleapis.com")) return "google"
  if (host === "api.air.inc") return "air"
  return host
}

export interface CredentialProxyOptions {
  /**
   * Given a session token (extracted from the Proxy-Authorization header, which
   * HTTP clients set automatically from the userinfo in the proxy URL) and an
   * integration name, resolve the Bearer/API token from the vault. Return null
   * if not found.
   */
  resolveToken: (sessionToken: string, integration: string) => Promise<string | null>
}

export interface CredentialProxy {
  port: number
  caCertPath: string
  close: () => Promise<void>
  getProxyEnv: (sessionToken: string) => Record<string, string>
}

export async function createCredentialProxy(
  options: CredentialProxyOptions
): Promise<CredentialProxy> {
  const ca = generateCA()
  const caCertPath = writeCACertFile()

  const server: Server = createServer()

  // Handle HTTP CONNECT method (HTTPS proxy tunnel)
  server.on("connect", (req: IncomingMessage, clientSocket: Socket, head: Buffer) => {
    const [host, portStr] = (req.url || "").split(":")
    const port = parseInt(portStr || "443", 10)

    if (!shouldIntercept(host)) {
      // Transparent tunnel — connect directly to the remote server
      const remote = new Socket()
      remote.connect(port, host, () => {
        clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
        remote.write(head)
        remote.pipe(clientSocket)
        clientSocket.pipe(remote)
      })
      remote.on("error", () => clientSocket.destroy())
      clientSocket.on("error", () => remote.destroy())
      return
    }

    // MITM intercept — terminate TLS with a cert for this host
    const hostCert = generateCertForHost(host, ca)
    const integration = hostToIntegration(host)

    // Extract session token from the Proxy-Authorization header.
    // HTTP clients automatically set this from the userinfo in the proxy URL
    // (e.g., HTTPS_PROXY=http://{token}@127.0.0.1:{port}).
    // The header value is "Basic base64(token:)" since userinfo is user:pass format.
    const proxyAuth = req.headers["proxy-authorization"] || ""
    const sessionToken = proxyAuth.startsWith("Basic ")
      ? Buffer.from(proxyAuth.slice(6), "base64").toString().replace(/:$/, "")
      : proxyAuth.replace(/^Bearer\s+/i, "")

    const tlsServer = createTlsServer(
      { key: hostCert.key, cert: hostCert.cert },
      async (tlsSocket) => {
        // Read the decrypted HTTP request from the agent
        let rawData = ""
        tlsSocket.on("data", async (chunk) => {
          rawData += chunk.toString()

          // Wait for headers to be complete
          if (!rawData.includes("\r\n\r\n")) return
          tlsSocket.pause()

          // Parse HTTP request
          const headerEnd = rawData.indexOf("\r\n\r\n")
          const headerSection = rawData.slice(0, headerEnd)
          const body = rawData.slice(headerEnd + 4)
          const lines = headerSection.split("\r\n")
          const requestLine = lines[0]

          // Resolve token from vault
          let authHeader: string | null = null
          if (sessionToken) {
            const token = await options.resolveToken(sessionToken, integration)
            if (token) {
              // Notion uses "Bearer <token>" while some use different schemes
              authHeader = integration === "notion"
                ? `Bearer ${token}`
                : `Bearer ${token}`
            }
          }

          // Rebuild headers, injecting/replacing Authorization
          const newHeaders: string[] = [requestLine]
          let hasAuth = false
          for (let i = 1; i < lines.length; i++) {
            if (lines[i].toLowerCase().startsWith("authorization:") && authHeader) {
              newHeaders.push(`Authorization: ${authHeader}`)
              hasAuth = true
            } else {
              newHeaders.push(lines[i])
            }
          }
          if (!hasAuth && authHeader) {
            newHeaders.push(`Authorization: ${authHeader}`)
          }

          // Connect to the real server
          const realSocket = tlsConnect(
            { host, port, servername: host },
            () => {
              realSocket.write(newHeaders.join("\r\n") + "\r\n\r\n" + body)
            }
          )

          realSocket.pipe(tlsSocket)
          tlsSocket.resume()
          tlsSocket.pipe(realSocket)

          realSocket.on("error", () => tlsSocket.destroy())
          tlsSocket.on("error", () => realSocket.destroy())
        })
      }
    )

    // Send 200 BEFORE emitting the TLS connection — otherwise the client
    // hasn't received the tunnel confirmation yet when the TLS handshake starts,
    // causing a race condition.
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
    tlsServer.emit("connection", clientSocket)
    if (head.length > 0) {
      clientSocket.unshift(head)
    }
  })

  return new Promise((resolve, reject) => {
    // Listen on a random port on localhost only
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address()
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to bind proxy server"))
        return
      }

      const proxy: CredentialProxy = {
        port: addr.port,
        caCertPath,
        close: () =>
          new Promise<void>((res) => {
            server.close(() => res())
          }),
        getProxyEnv: (sessionToken: string) => ({
          HTTPS_PROXY: `http://${sessionToken}@127.0.0.1:${addr.port}`,
          NODE_EXTRA_CA_CERTS: caCertPath,
          NODE_USE_ENV_PROXY: "1",
        }),
      }

      console.log(`Credential proxy listening on 127.0.0.1:${addr.port}`)
      resolve(proxy)
    })

    server.on("error", reject)
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/inbox && npx vitest run server/lib/__tests__/credential-proxy.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/lib/credential-proxy.ts server/lib/__tests__/credential-proxy.test.ts
git commit -m "feat: add HTTPS credential proxy with MITM interception"
```

### Task 5: Wire proxy into session manager

**Files:**
- Modify: `server/lib/session-manager.ts`
- Modify: `server/index.ts`

- [ ] **Step 1: Add proxy startup to server/index.ts**

Import and start the proxy after DB initialization. Store a reference so session-manager can use it.

In `server/index.ts`, after `initializeDatabase()`:

```typescript
import { createCredentialProxy } from "./lib/credential-proxy.js"
import { resolveCredential } from "./lib/vault.js"
import { setCredentialProxy } from "./lib/session-manager.js"

// After initializeDatabase(), add:

// Start credential proxy (non-blocking)
createCredentialProxy({
  resolveToken: async (sessionToken, integration) => {
    // Look up the user from the session token, then resolve their credential
    const session = getSession(sessionToken)
    if (!session) return null
    return resolveCredential(session.user.email, workspacePath, integration)
  },
})
  .then((proxy) => {
    setCredentialProxy(proxy)
    console.log(`Credential proxy ready on port ${proxy.port}`)
  })
  .catch((err) => console.error("Failed to start credential proxy:", err))
```

- [ ] **Step 2: Modify buildAgentEnv() in session-manager.ts**

Replace the current `buildAgentEnv()` that passes raw env vars with one that uses the proxy. Add a `userSessionToken` parameter.

Add at the top of `session-manager.ts`:

```typescript
import type { CredentialProxy } from "./credential-proxy.js"

let credentialProxy: CredentialProxy | null = null

export function setCredentialProxy(proxy: CredentialProxy) {
  credentialProxy = proxy
}
```

Then modify `buildAgentEnv()`:

```typescript
function buildAgentEnv(userSessionToken?: string): Record<string, string> {
  const env: Record<string, string> = {}

  // Base env: inherit process env minus sensitive keys
  const excluded = new Set([
    "ANTHROPIC_API_KEY", "CLAUDECODE",
    // Exclude raw API tokens — the proxy injects these
    "NOTION_API_TOKEN", "GOOGLE_REFRESH_TOKEN", "GOOGLE_CLIENT_SECRET",
    "SLACK_BOT_TOKEN", "SHOPIFY_ACCESS_TOKEN", "GITHUB_TOKEN",
    "VAULT_SECRET",
  ])
  for (const [k, v] of Object.entries(process.env)) {
    if (!excluded.has(k) && v !== undefined) {
      env[k] = v
    }
  }

  // If the credential proxy is running, route traffic through it
  if (credentialProxy && userSessionToken) {
    Object.assign(env, credentialProxy.getProxyEnv(userSessionToken))
  } else {
    // Fallback: pass workspace credentials directly (pre-proxy migration)
    Object.assign(env, getAgentEnv())
  }

  return env
}
```

- [ ] **Step 3: Thread userSessionToken through startSession and resumeSessionQuery**

In both `startSession()` and `resumeSessionQuery()`, accept an optional `userSessionToken` parameter and pass it to `buildAgentEnv()`.

In `startSession()`, update the signature:

```typescript
export async function startSession(
  prompt: string,
  options?: {
    linkedEmailId?: string
    linkedEmailThreadId?: string
    linkedTaskId?: string
    triggerSource?: string
    userSessionToken?: string
  },
): Promise<string> {
```

And update the `query()` call:

```typescript
env: buildAgentEnv(options?.userSessionToken),
```

Similarly for `resumeSessionQuery()`:

```typescript
export async function resumeSessionQuery(
  sessionId: string,
  prompt: string,
  userSessionToken?: string
): Promise<void> {
```

And:

```typescript
env: buildAgentEnv(userSessionToken),
```

- [ ] **Step 4: Thread userSessionToken from routes**

In `server/routes/sessions.ts`, extract the session cookie and pass it through. In the POST `/` (create session) and POST `/:id/resume` handlers, add:

```typescript
import { getCookie } from "hono/cookie"
import { SESSION_COOKIE } from "./auth.js"

// In the create handler:
const userSessionToken = getCookie(c, SESSION_COOKIE)

// Pass to startSession:
const sessionId = await sessions.startSession(prompt, {
  ...options,
  userSessionToken,
})

// In the resume handler:
const userSessionToken = getCookie(c, SESSION_COOKIE)
await sessions.resumeSessionQuery(sessionId, prompt, userSessionToken)
```

- [ ] **Step 5: Run tests**

Run: `cd packages/inbox && npm run test:ci`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/index.ts server/lib/session-manager.ts server/routes/sessions.ts
git commit -m "feat: wire credential proxy into session lifecycle

Agent subprocesses now receive HTTPS_PROXY + NODE_EXTRA_CA_CERTS instead
of raw API tokens. The proxy injects Authorization headers from the vault."
```

---

## Chunk 3: OAuth Connection Flows

Server routes that let users connect their OAuth accounts. Each integration has a configuration (client ID, scopes, OAuth URLs). The callback stores the encrypted token in `user_credentials`.

### Task 6: Integration registry

**Files:**
- Create: `server/lib/integrations.ts`

- [ ] **Step 1: Create the integration registry**

```typescript
// server/lib/integrations.ts

export interface IntegrationConfig {
  id: string
  name: string
  icon: string            // emoji or lucide icon name
  scope: "user" | "workspace"
  authType: "oauth2" | "api_key"
  // OAuth2 fields (only if authType === "oauth2")
  authUrl?: string
  tokenUrl?: string
  scopes?: string[]
  clientIdEnv?: string    // env var name for client ID
  clientSecretEnv?: string
}

export const INTEGRATIONS: IntegrationConfig[] = [
  {
    id: "notion",
    name: "Notion",
    icon: "book-open",
    scope: "user",
    authType: "oauth2",
    authUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    scopes: [],
    clientIdEnv: "NOTION_OAUTH_CLIENT_ID",
    clientSecretEnv: "NOTION_OAUTH_CLIENT_SECRET",
  },
  {
    id: "slack",
    name: "Slack",
    icon: "message-square",
    scope: "user",
    authType: "oauth2",
    authUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    scopes: ["channels:read", "channels:history", "chat:write", "users:read"],
    clientIdEnv: "SLACK_CLIENT_ID",
    clientSecretEnv: "SLACK_CLIENT_SECRET",
  },
  {
    id: "github",
    name: "GitHub",
    icon: "github",
    scope: "user",
    authType: "oauth2",
    authUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scopes: ["repo", "read:org"],
    clientIdEnv: "GITHUB_CLIENT_ID",
    clientSecretEnv: "GITHUB_CLIENT_SECRET",
  },
  {
    id: "shopify",
    name: "Shopify",
    icon: "shopping-bag",
    scope: "workspace",
    authType: "api_key",
  },
  {
    id: "air",
    name: "Air",
    icon: "image",
    scope: "workspace",
    authType: "api_key",
  },
]

export function getIntegration(id: string): IntegrationConfig | undefined {
  return INTEGRATIONS.find((i) => i.id === id)
}

export function getOAuthIntegrations(): IntegrationConfig[] {
  return INTEGRATIONS.filter((i) => i.authType === "oauth2")
}
```

- [ ] **Step 2: Commit**

```bash
git add server/lib/integrations.ts
git commit -m "feat: add integration registry with OAuth + API key configs"
```

### Task 7: Connection routes (OAuth flows + CRUD)

**Files:**
- Create: `server/routes/connections.ts`
- Modify: `server/index.ts`

- [ ] **Step 1: Create the connections routes**

```typescript
// server/routes/connections.ts
import { Hono } from "hono"
import { getCookie } from "hono/cookie"
import { SESSION_COOKIE } from "./auth.js"
import { getSession } from "../lib/auth.js"
import { getIntegration, INTEGRATIONS, type IntegrationConfig } from "../lib/integrations.js"
import {
  storeUserCredential,
  listUserCredentials,
  deleteUserCredential,
  listWorkspaceCredentials,
} from "../lib/vault.js"
import { getWorkspacePath } from "../lib/session-manager.js"
import { randomBytes } from "crypto"

export const connectionRoutes = new Hono()

// In-memory OAuth state store (short-lived, keyed by random state param)
const oauthStates = new Map<
  string,
  { userEmail: string; integration: string; expiresAt: number }
>()

// Clean expired states periodically
setInterval(() => {
  const now = Date.now()
  for (const [key, val] of oauthStates) {
    if (val.expiresAt < now) oauthStates.delete(key)
  }
}, 60_000)

function getCurrentUser(c: any): { email: string; name: string } | null {
  const token = getCookie(c, SESSION_COOKIE)
  if (!token) return null
  const session = getSession(token)
  return session?.user ? { email: session.user.email, name: session.user.name } : null
}

/**
 * GET /connections — list all integrations with connection status
 */
connectionRoutes.get("/", (c) => {
  const user = getCurrentUser(c)
  if (!user) return c.json({ error: "Unauthorized" }, 401)

  const userCreds = listUserCredentials(user.email)
  const workspaceCreds = listWorkspaceCredentials(getWorkspacePath())

  const connectedUserIntegrations = new Set(userCreds.map((c) => c.integration))
  const connectedWorkspaceIntegrations = new Set(workspaceCreds.map((c) => c.integration))

  const integrations = INTEGRATIONS.map((config) => ({
    id: config.id,
    name: config.name,
    icon: config.icon,
    scope: config.scope,
    authType: config.authType,
    connected:
      config.scope === "user"
        ? connectedUserIntegrations.has(config.id)
        : connectedWorkspaceIntegrations.has(config.id),
  }))

  return c.json({ integrations })
})

/**
 * GET /connections/connect/:integration — start OAuth flow
 * Redirects the user to the OAuth provider's authorization URL.
 */
connectionRoutes.get("/connect/:integration", (c) => {
  const user = getCurrentUser(c)
  if (!user) return c.json({ error: "Unauthorized" }, 401)

  const integrationId = c.req.param("integration")
  const config = getIntegration(integrationId)
  if (!config) return c.json({ error: "Unknown integration" }, 404)
  if (config.authType !== "oauth2") {
    return c.json({ error: "This integration does not support OAuth" }, 400)
  }
  if (!config.authUrl || !config.clientIdEnv) {
    return c.json({ error: "OAuth not configured for this integration" }, 400)
  }

  const clientId = process.env[config.clientIdEnv]
  if (!clientId) {
    return c.json({ error: `${config.clientIdEnv} not configured` }, 500)
  }

  // Generate state param for CSRF protection
  const state = randomBytes(24).toString("hex")
  oauthStates.set(state, {
    userEmail: user.email,
    integration: integrationId,
    expiresAt: Date.now() + 10 * 60 * 1000, // 10 min
  })

  // Build the redirect URL
  const redirectUri = `${c.req.header("origin") || ""}/api/connections/connect/${integrationId}/callback`
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
  })

  if (config.scopes?.length) {
    params.set("scope", config.scopes.join(" "))
  }

  // Notion uses a slightly different param name
  if (integrationId === "notion") {
    params.set("owner", "user")
  }

  return c.redirect(`${config.authUrl}?${params}`)
})

/**
 * GET /connections/connect/:integration/callback — OAuth callback
 * Exchanges the authorization code for tokens and stores them.
 */
connectionRoutes.get("/connect/:integration/callback", async (c) => {
  const integrationId = c.req.param("integration")
  const code = c.req.query("code")
  const state = c.req.query("state")
  const error = c.req.query("error")

  if (error) {
    // Redirect back to settings with error
    return c.redirect(`/settings/integrations?error=${encodeURIComponent(error)}`)
  }

  if (!code || !state) {
    return c.json({ error: "Missing code or state" }, 400)
  }

  const oauthState = oauthStates.get(state)
  if (!oauthState || oauthState.expiresAt < Date.now()) {
    return c.json({ error: "Invalid or expired state" }, 400)
  }
  oauthStates.delete(state)

  if (oauthState.integration !== integrationId) {
    return c.json({ error: "Integration mismatch" }, 400)
  }

  const config = getIntegration(integrationId)
  if (!config || !config.tokenUrl || !config.clientIdEnv || !config.clientSecretEnv) {
    return c.json({ error: "Integration not configured" }, 500)
  }

  const clientId = process.env[config.clientIdEnv]!
  const clientSecret = process.env[config.clientSecretEnv]!
  const redirectUri = `${c.req.header("origin") || ""}/api/connections/connect/${integrationId}/callback`

  // Exchange code for token
  let tokenBody: URLSearchParams | string
  let tokenHeaders: Record<string, string> = {}

  if (integrationId === "notion") {
    // Notion uses Basic auth for token exchange
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64")
    tokenHeaders = {
      "Authorization": `Basic ${basicAuth}`,
      "Content-Type": "application/json",
    }
    tokenBody = JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    })
  } else {
    tokenHeaders = { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" }
    tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString()
  }

  const tokenRes = await fetch(config.tokenUrl, {
    method: "POST",
    headers: tokenHeaders,
    body: tokenBody,
  })

  if (!tokenRes.ok) {
    const text = await tokenRes.text()
    console.error(`OAuth token exchange failed for ${integrationId}:`, text)
    return c.redirect(`/settings/integrations?error=${encodeURIComponent("Token exchange failed")}`)
  }

  const tokenData = await tokenRes.json()

  // Extract token (different providers use different field names)
  const accessToken =
    tokenData.access_token ||
    tokenData.authed_user?.access_token || // Slack v2
    tokenData.bot?.bot_access_token

  if (!accessToken) {
    console.error("No access_token in response:", tokenData)
    return c.redirect(`/settings/integrations?error=${encodeURIComponent("No access token returned")}`)
  }

  storeUserCredential(oauthState.userEmail, integrationId, {
    token: accessToken,
    refreshToken: tokenData.refresh_token,
    scopes: tokenData.scope || config.scopes?.join(","),
    expiresAt: tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
      : undefined,
  })

  // Redirect back to settings
  return c.redirect(`/settings/integrations?connected=${integrationId}`)
})

/**
 * DELETE /connections/:integration — disconnect an integration
 */
connectionRoutes.delete("/:integration", (c) => {
  const user = getCurrentUser(c)
  if (!user) return c.json({ error: "Unauthorized" }, 401)

  const integrationId = c.req.param("integration")
  const config = getIntegration(integrationId)
  if (!config) return c.json({ error: "Unknown integration" }, 404)
  if (config.scope !== "user") {
    return c.json({ error: "Workspace integrations cannot be disconnected from the UI" }, 403)
  }

  deleteUserCredential(user.email, integrationId)
  return c.json({ ok: true })
})
```

- [ ] **Step 2: Mount the routes in index.ts**

In `server/index.ts`, add:

```typescript
import { connectionRoutes } from "./routes/connections.js"

// After the other protected route mounts:
app.route("/api/connections", connectionRoutes)
```

- [ ] **Step 3: Run tests**

Run: `cd packages/inbox && npm run test:ci`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add server/routes/connections.ts server/index.ts server/lib/integrations.ts
git commit -m "feat: add OAuth connection routes (connect, callback, disconnect)"
```

---

## Chunk 4: Auth Middleware Enhancement

Add user email to request context so all routes can access the current user without re-querying.

### Task 8: Add user context to auth middleware

**Files:**
- Modify: `server/index.ts`
- Modify: `server/lib/auth.ts`

- [ ] **Step 1: Add typed user context to Hono**

In `server/index.ts`, update the auth middleware to store the user on the context:

```typescript
// Update the Hono app type to include user context:
type AppBindings = {
  Variables: {
    user: { name: string; email: string; picture?: string }
    userEmail: string   // convenience — Phase 3+ routes use c.get("userEmail")
    userName: string    // convenience — Phase 3+ routes use c.get("userName")
    sessionToken: string
  }
}

const app = new Hono<AppBindings>()
```

Then update the middleware:

```typescript
app.use("/api/*", async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE)
  if (!token || !getSession(token)) {
    return c.json({ error: "Unauthorized" }, 401)
  }
  const session = getSession(token)!
  c.set("user", session.user)
  c.set("userEmail", session.user.email)
  c.set("userName", session.user.name)
  c.set("sessionToken", token)
  await next()
})
```

Now any route can access `c.get("user")`, `c.get("userEmail")`, `c.get("userName")`, and `c.get("sessionToken")` without re-reading the cookie.

> **Note for Phase 3+:** Routes that need the current user's email (e.g., credential lookups, per-user data) should call `c.get("userEmail")` directly. This avoids coupling to the full user object shape and keeps route handlers concise.

- [ ] **Step 2: Run tests**

Run: `cd packages/inbox && npm run test:ci`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add server/index.ts
git commit -m "feat: add user + sessionToken to Hono request context"
```

---

## Chunk 5: Frontend — Integrations Settings Page

### Task 9: Add connection types and API client functions

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/api/client.ts`

- [ ] **Step 1: Add types**

In `src/types/index.ts`, add:

```typescript
export interface Integration {
  id: string
  name: string
  icon: string
  scope: "user" | "workspace"
  authType: "oauth2" | "api_key"
  connected: boolean
}
```

- [ ] **Step 2: Add API client functions**

In `src/api/client.ts`, add a "Connections" section:

```typescript
// Connections

export async function getConnections() {
  return request<{ integrations: import("@/types").Integration[] }>(`/connections`)
}

export async function disconnectIntegration(integration: string) {
  return request<{ ok: boolean }>(`/connections/${integration}`, {
    method: "DELETE",
  })
}

/**
 * Get the OAuth connect URL for an integration.
 * Returns the URL to redirect to (browser navigation, not fetch).
 */
export function getConnectUrl(integration: string): string {
  return `${BASE}/connections/connect/${integration}`
}
```

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts src/api/client.ts
git commit -m "feat: add connection types and API client functions"
```

### Task 10: Connections hook

**Files:**
- Create: `src/hooks/use-connections.ts`

- [ ] **Step 1: Create the hook**

```typescript
// src/hooks/use-connections.ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { getConnections, disconnectIntegration } from "@/api/client"

export function useConnections() {
  return useQuery({
    queryKey: ["connections"],
    queryFn: () => getConnections(),
    select: (data) => data.integrations,
  })
}

export function useDisconnectIntegration() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (integration: string) => disconnectIntegration(integration),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["connections"] })
    },
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/use-connections.ts
git commit -m "feat: add useConnections + useDisconnectIntegration hooks"
```

### Task 11: IntegrationCard component

**Files:**
- Create: `src/components/settings/IntegrationCard.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/settings/IntegrationCard.tsx
import { Button, Badge } from "@hammies/frontend/components/ui"
import { cn } from "@hammies/frontend/lib/utils"
import { getConnectUrl } from "@/api/client"
import { useDisconnectIntegration } from "@/hooks/use-connections"
import type { Integration } from "@/types"

interface IntegrationCardProps {
  integration: Integration
}

export function IntegrationCard({ integration }: IntegrationCardProps) {
  const disconnect = useDisconnectIntegration()

  function handleConnect() {
    // Navigate to OAuth flow (full-page redirect)
    window.location.href = getConnectUrl(integration.id)
  }

  function handleDisconnect() {
    if (confirm(`Disconnect ${integration.name}?`)) {
      disconnect.mutate(integration.id)
    }
  }

  const isWorkspace = integration.scope === "workspace"

  return (
    <div className="flex items-center justify-between rounded-lg border p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
          <span className="text-lg">{integrationEmoji(integration.id)}</span>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium">{integration.name}</span>
            {isWorkspace && (
              <Badge variant="secondary" className="text-xs">
                Managed by admin
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {integration.connected ? "Connected" : "Not connected"}
          </p>
        </div>
      </div>
      <div>
        {integration.connected ? (
          isWorkspace ? (
            <Badge variant="outline" className="text-green-600">
              Active
            </Badge>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={handleDisconnect}
              disabled={disconnect.isPending}
            >
              Disconnect
            </Button>
          )
        ) : isWorkspace ? (
          <Badge variant="outline" className="text-muted-foreground">
            Not configured
          </Badge>
        ) : (
          <Button size="sm" onClick={handleConnect}>
            Connect
          </Button>
        )}
      </div>
    </div>
  )
}

function integrationEmoji(id: string): string {
  const map: Record<string, string> = {
    notion: "📝",
    slack: "💬",
    github: "🐙",
    shopify: "🛍️",
    air: "🖼️",
    google: "📧",
  }
  return map[id] || "🔗"
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/settings/IntegrationCard.tsx
git commit -m "feat: add IntegrationCard component"
```

### Task 12: IntegrationsPage component

**Files:**
- Create: `src/components/settings/IntegrationsPage.tsx`

- [ ] **Step 1: Create the page**

```tsx
// src/components/settings/IntegrationsPage.tsx
import { useConnections } from "@/hooks/use-connections"
import { IntegrationCard } from "./IntegrationCard"
import { useSearchParams } from "react-router-dom"
import { useEffect } from "react"

export function IntegrationsPage() {
  const { data: integrations, isLoading } = useConnections()
  const [searchParams, setSearchParams] = useSearchParams()

  const error = searchParams.get("error")
  const connected = searchParams.get("connected")

  // Clear URL params after showing status
  useEffect(() => {
    if (error || connected) {
      const timeout = setTimeout(() => {
        setSearchParams({})
      }, 5000)
      return () => clearTimeout(timeout)
    }
  }, [error, connected, setSearchParams])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="text-muted-foreground">Loading integrations...</span>
      </div>
    )
  }

  const userIntegrations = integrations?.filter((i) => i.scope === "user") || []
  const workspaceIntegrations = integrations?.filter((i) => i.scope === "workspace") || []

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-6">
      <div>
        <h1 className="text-2xl font-bold">Integrations</h1>
        <p className="text-muted-foreground mt-1">
          Connect your accounts to let the AI agent access your tools.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          Connection failed: {error}
        </div>
      )}

      {connected && (
        <div className="rounded-md border border-green-500/50 bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-400">
          Successfully connected {connected}!
        </div>
      )}

      {userIntegrations.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Your Accounts</h2>
          <p className="text-sm text-muted-foreground">
            Connect your personal accounts. Only you can access these credentials.
          </p>
          <div className="space-y-2">
            {userIntegrations.map((integration) => (
              <IntegrationCard key={integration.id} integration={integration} />
            ))}
          </div>
        </section>
      )}

      {workspaceIntegrations.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Workspace</h2>
          <p className="text-sm text-muted-foreground">
            Shared service accounts managed by the workspace admin via CLI.
          </p>
          <div className="space-y-2">
            {workspaceIntegrations.map((integration) => (
              <IntegrationCard key={integration.id} integration={integration} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/settings/IntegrationsPage.tsx
git commit -m "feat: add IntegrationsPage settings component"
```

### Task 13: Add route and sidebar navigation

**Files:**
- Modify: `src/App.tsx` (or wherever routes are defined)
- Modify: `src/components/layout/AppSidebar.tsx`

- [ ] **Step 1: Add settings route**

Find the route definitions (likely in `src/App.tsx` or a router config file) and add:

```tsx
import { IntegrationsPage } from "@/components/settings/IntegrationsPage"

// Add route:
<Route path="/settings/integrations" element={<IntegrationsPage />} />
```

- [ ] **Step 2: Add settings link to sidebar dropdown**

In `AppSidebar.tsx`, add a "Settings" item to the dropdown menu (in the same `DropdownMenuGroup` that contains the "Log out" item):

```tsx
import { Settings } from "lucide-react"

// Before the LogOut menu item, add:
<DropdownMenuItem onClick={() => navigate("/settings/integrations")}>
  <Settings />
  Integrations
</DropdownMenuItem>
<DropdownMenuSeparator />
```

This places the integrations link in the profile dropdown at the top of the sidebar — accessible but not cluttering the main nav.

- [ ] **Step 3: Run tests**

Run: `cd packages/inbox && npm run test:ci`
Expected: PASS

- [ ] **Step 4: Manual verification**

1. Click the Hammies dropdown at the top of the sidebar
2. Click "Integrations" — settings page loads
3. See "Your Accounts" section with Notion, Slack, GitHub — each with "Connect" button
4. See "Workspace" section with Shopify, Air — shown as "Managed by admin"
5. Click "Connect" on a user integration — redirects to OAuth provider
6. After OAuth callback, token is stored and card shows "Disconnect"
7. Click "Disconnect" — credential is removed, card shows "Connect" again

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/layout/AppSidebar.tsx
git commit -m "feat: add integrations settings page to sidebar navigation"
```

---

## Chunk 6: VAULT_SECRET Setup + Environment Config

### Task 14: Generate and configure VAULT_SECRET

**Files:**
- Modify: `server/index.ts` (add VAULT_SECRET validation on startup)

- [ ] **Step 1: Add VAULT_SECRET validation**

In `server/index.ts`, after loading the inbox `.env` but before starting anything:

```typescript
// Validate VAULT_SECRET
if (!process.env.VAULT_SECRET || process.env.VAULT_SECRET.length < 64) {
  console.warn(
    "WARNING: VAULT_SECRET not set or too short. Credential vault will not work.\n" +
    "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
  )
}
```

- [ ] **Step 2: Add VAULT_SECRET to inbox .env.example**

Create or update `.env.example` in `packages/inbox/`:

```env
# Google Sign-In (for user authentication)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Credential vault encryption key (64-char hex = 32 bytes)
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
VAULT_SECRET=

# OAuth app credentials (for user connection flows)
NOTION_OAUTH_CLIENT_ID=
NOTION_OAUTH_CLIENT_SECRET=
SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
```

- [ ] **Step 3: Generate a real VAULT_SECRET for local dev**

Run: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

Add the output to `packages/inbox/.env` as `VAULT_SECRET=<generated>`.

- [ ] **Step 4: Commit**

```bash
git add server/index.ts .env.example
git commit -m "feat: add VAULT_SECRET validation and .env.example"
```

---

## Chunk 7: Migrate Existing Workspace Credentials

### Task 15: Migration script to import workspace .env creds into vault

**Files:**
- Create: `server/scripts/migrate-env-to-vault.ts`

- [ ] **Step 1: Write the migration script**

This one-time script reads existing workspace `.env` credentials and stores them as workspace-scoped credentials in the vault, enabling a smooth transition.

```typescript
// server/scripts/migrate-env-to-vault.ts
import { config } from "dotenv"
import { resolve } from "path"
import { initializeDatabase } from "../db/schema.js"
import { storeWorkspaceCredential, storeUserCredential } from "../lib/vault.js"

// Load inbox .env (for VAULT_SECRET)
config({ path: resolve(import.meta.dirname, "../../.env") })

const workspacePath = process.argv[2]
if (!workspacePath) {
  console.error("Usage: tsx server/scripts/migrate-env-to-vault.ts <workspace-path>")
  process.exit(1)
}

// Load workspace .env
const workspaceEnv = config({ path: resolve(workspacePath, ".env") })
const creds = workspaceEnv.parsed || {}

initializeDatabase()

// Map known env vars to integration + scope
const ENV_TO_INTEGRATION: Record<string, { integration: string; scope: "workspace" | "user" }> = {
  NOTION_API_TOKEN: { integration: "notion", scope: "workspace" },
  SLACK_BOT_TOKEN: { integration: "slack", scope: "workspace" },
  SHOPIFY_ACCESS_TOKEN: { integration: "shopify", scope: "workspace" },
  GITHUB_TOKEN: { integration: "github", scope: "workspace" },
  AIR_API_KEY: { integration: "air", scope: "workspace" },
}

const workspaceName = workspacePath.split("/").pop() || workspacePath

let count = 0
for (const [envKey, value] of Object.entries(creds)) {
  const mapping = ENV_TO_INTEGRATION[envKey]
  if (!mapping || !value) continue

  storeWorkspaceCredential(workspaceName, mapping.integration, value)
  console.log(`Migrated ${envKey} → workspace_credentials[${workspaceName}, ${mapping.integration}]`)
  count++
}

console.log(`\nDone. Migrated ${count} credentials.`)
```

- [ ] **Step 2: Run the migration**

```bash
cd packages/inbox && npx tsx server/scripts/migrate-env-to-vault.ts ~/Github/hammies/hammies-agent
```

- [ ] **Step 3: Commit**

```bash
git add server/scripts/migrate-env-to-vault.ts
git commit -m "feat: add migration script for workspace .env → credential vault"
```

---

## Final Verification

- [ ] **Run full test suite**: `cd packages/inbox && npm run test:ci`
- [ ] **Manual smoke test**:
  1. Start dev server: `npm run dev -- --workspace ~/Github/hammies/hammies-agent`
  2. Log in via Google OAuth
  3. Open Integrations from sidebar dropdown
  4. Verify workspace credentials show as "Active" (after migration)
  5. Connect a user-scoped integration (e.g., Notion) via OAuth
  6. Start a new session that uses Notion — verify the proxy injects the token
  7. Check agent subprocess env — should have `HTTPS_PROXY` (with session token in URL userinfo), `NODE_EXTRA_CA_CERTS` but NOT raw tokens
  8. Disconnect the integration — verify credential is deleted
- [ ] **Update TODO.md**: Mark Phase 2 as done

---

## Summary of Changes

| Area | Before | After |
|------|--------|-------|
| Credentials | Single workspace `.env`, raw tokens in agent env | AES-256-GCM vault, per-user + per-workspace scoping |
| Agent subprocess | Receives raw API tokens as env vars | Receives `HTTPS_PROXY` + `NODE_EXTRA_CA_CERTS`; tokens never exposed |
| Token injection | N/A | Localhost MITM proxy intercepts known API hosts, injects `Authorization` |
| User connections | N/A | OAuth flows for Notion, Slack, GitHub; API key via CLI for Shopify, Air |
| Settings UI | None | Integrations page: connect/disconnect user accounts, view workspace creds |
| DB tables | `users`, `auth_sessions` | + `user_credentials`, `workspace_credentials` |

## Subsequent Plans (separate specs)

- **Phase 3: Collaboration + Output Sharing** — presence, session sharing, output snapshots
- **Phase 4: Rich Session Outputs + React Artifacts** — render_output tool, OutputRenderer, panel stack, iframe sandbox
- **Phase 5: Source Plugins** — SourcePlugin interface, Gmail/Notion refactor, Slack plugin
- **Phase 6: Self-Improving System + Retrieval** — error recovery, FTS indexing, context-backfill
