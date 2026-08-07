import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * `server/index.ts` boots the whole server on import (DB pool, credential
 * store, plugin discovery, HTTP listeners) — importing it here to exercise
 * `resolveCredential` directly would require standing up Postgres and every
 * dependency it touches. Instead this asserts on the source text, the same
 * pattern used for scheduled-job credential isolation (see
 * packages/agent/plugins/context/scripts/__tests__/scheduled-credentials.test.ts):
 * it fails the moment the callback's structure drifts from the scenario it
 * documents, without needing a live server.
 */
const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf8")

/** Just the `resolveCredential` callback body passed to `createCredentialProxy`. */
function resolveCredentialCallback(): string {
  const start = indexSource.indexOf("createCredentialProxy({")
  if (start === -1) throw new Error("createCredentialProxy(...) call not found in server/index.ts")
  const end = indexSource.indexOf("\n})", start)
  if (end === -1) throw new Error("could not find the end of the createCredentialProxy(...) call")
  return indexSource.slice(start, end)
}

describe("credential proxy resolveCredential callback", () => {
  it("Scenario: The credential proxy's `resolveCredential` callback resolves by integration scope, not one fallback chain", () => {
    const callback = resolveCredentialCallback()

    // Workspace-scope integrations mint/refresh through resolveWorkspaceAccessToken
    // — never the raw vault lookup (which would hand back a service-account
    // JSON blob verbatim for a service_account row).
    expect(callback).toMatch(/config\?\.scope === "workspace"/)
    expect(callback).toContain("resolveWorkspaceAccessToken(workspaceId, integration)")

    // User-scope integrations still resolve through the per-user OAuth
    // refresh, falling back to the legacy vault lookup only when no
    // OAuth-refreshable row exists.
    expect(callback).toContain("maybeRefreshToken(session.user.email, integration)")
    expect(callback).toContain("resolveCredential(session.user.email, workspaceId, integration)")

    // Both paths key on registeredWorkspaces[...].id (basename(path), the
    // same key seedWorkspaceCredentials uses) — not a raw workspace path,
    // which would never match a seeded row.
    expect(callback).toMatch(/workspaceId\s*=\s*registeredWorkspaces\[0\]\?\.id/)
    expect(callback).not.toMatch(/workspacePaths\[0\]/)

    // Config-backed extra headers (e.g. Google Ads' developer-token) resolve
    // via resolveConfigVar inside this trusted process and ride in `extras`,
    // keyed by their valueEnv name — never left for the agent to supply.
    expect(callback).toContain("resolveConfigVar(session.user.email, workspaceId, integration, valueEnv)")
    expect(callback).toMatch(/extras\[valueEnv\]\s*=\s*value/)
  })

  it("imports the scope-aware resolvers from the shared vault/integrations shims", () => {
    expect(indexSource).toMatch(/import\s*\{[^}]*resolveWorkspaceAccessToken[^}]*\}\s*from\s*"\.\/lib\/vault\.js"/s)
    expect(indexSource).toMatch(/import\s*\{[^}]*resolveConfigVar[^}]*\}\s*from\s*"\.\/lib\/vault\.js"/s)
    expect(indexSource).toMatch(/import\s*\{[^}]*getIntegration[^}]*\}\s*from\s*"\.\/lib\/integrations\.js"/s)
  })
})
