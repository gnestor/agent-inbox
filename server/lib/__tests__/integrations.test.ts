import { describe, it, expect } from "vitest"
import { INTEGRATIONS, getIntegration, getOAuthIntegrations, buildEnvToIntegrationMap } from "../integrations.js"

describe("integration registry", () => {
  it("Scenario: Each integration declares its credential env var — every record has a non-empty envVars.credential", () => {
    for (const integration of INTEGRATIONS) {
      expect(typeof integration.envVars.credential).toBe("string")
      expect(integration.envVars.credential.length).toBeGreaterThan(0)
      if (integration.envVars.config) {
        expect(Array.isArray(integration.envVars.config)).toBe(true)
      }
    }
  })

  it("Scenario: OAuth integrations carry endpoint metadata — oauth2 records include authUrl/tokenUrl/scopes/clientIdEnv/clientSecretEnv", () => {
    for (const integration of INTEGRATIONS.filter((i) => i.authType === "oauth2")) {
      expect(integration.authUrl).toBeTruthy()
      expect(integration.tokenUrl).toBeTruthy()
      expect(integration.scopes).toBeDefined()
      expect(integration.clientIdEnv).toBeTruthy()
      expect(integration.clientSecretEnv).toBeTruthy()
    }
    // Provider-specific token-exchange variation is encoded as optional flags.
    expect(getIntegration("pinterest")!.tokenAuthMethod).toBe("basic")
    expect(getIntegration("notion")!.tokenContentType).toBe("json")
  })

  it("Scenario: `buildEnvToIntegrationMap()` covers only workspace scope — maps credential env → id for workspace integrations only", () => {
    const map = buildEnvToIntegrationMap()
    const workspaceIds = new Set(INTEGRATIONS.filter((i) => i.scope === "workspace").map((i) => i.id))
    for (const integration of INTEGRATIONS) {
      if (integration.scope === "workspace") {
        // Every workspace credential env var is in the map and points at a
        // workspace integration (multiple may share an env var, last wins).
        expect(workspaceIds.has(map[integration.envVars.credential])).toBe(true)
      }
    }
    // The map never attributes a credential to a user-scoped integration —
    // user OAuth tokens must come from a per-user flow, not .env seeding.
    const userIds = new Set(INTEGRATIONS.filter((i) => i.scope === "user").map((i) => i.id))
    for (const id of Object.values(map)) {
      expect(userIds.has(id)).toBe(false)
    }
  })

  it("Scenario: The connect route reads only registry fields — authorize-URL inputs are all present on the record", () => {
    // The generic /api/connections/connect/:integration route reads authUrl,
    // scopes, clientIdEnv, and optional authParams directly from the registry —
    // no per-integration code branches. Assert those fields exist for OAuth records.
    for (const integration of getOAuthIntegrations()) {
      expect(integration.authUrl).toBeTruthy()
      expect(integration.clientIdEnv).toBeTruthy()
      expect(Array.isArray(integration.scopes)).toBe(true)
      if (integration.authParams) {
        expect(typeof integration.authParams).toBe("object")
      }
    }
  })

  it("Scenario: Token exchange honors `tokenAuthMethod` and `tokenContentType` — registry encodes per-provider exchange flags", () => {
    // The callback reads these flags rather than branching per provider:
    // basic → Authorization: Basic; json → JSON body + application/json.
    for (const integration of getOAuthIntegrations()) {
      if (integration.tokenAuthMethod !== undefined) {
        expect(["basic", "body"]).toContain(integration.tokenAuthMethod)
      }
      if (integration.tokenContentType !== undefined) {
        expect(["json", "form"]).toContain(integration.tokenContentType)
      }
    }
    expect(getIntegration("pinterest")!.tokenAuthMethod).toBe("basic")
    expect(getIntegration("notion")!.tokenContentType).toBe("json")
  })

  it("contains expected integrations", () => {
    const ids = INTEGRATIONS.map((i) => i.id)
    expect(ids).toContain("notion")
    expect(ids).toContain("slack")
    expect(ids).toContain("github")
    expect(ids).toContain("google")
    expect(ids).toContain("shopify")
    expect(ids).toContain("air")
  })

  it("each integration has required fields", () => {
    for (const integration of INTEGRATIONS) {
      expect(integration.id).toBeTruthy()
      expect(integration.name).toBeTruthy()
      expect(integration.icon).toBeTruthy()
      expect(["user", "workspace"]).toContain(integration.scope)
      expect(["oauth2", "api_key"]).toContain(integration.authType)
    }
  })

  it("OAuth integrations have auth URLs and env var names", () => {
    const oauthIntegrations = INTEGRATIONS.filter((i) => i.authType === "oauth2")
    expect(oauthIntegrations.length).toBeGreaterThan(0)
    for (const integration of oauthIntegrations) {
      expect(integration.authUrl).toBeTruthy()
      expect(integration.tokenUrl).toBeTruthy()
      expect(integration.clientIdEnv).toBeTruthy()
      expect(integration.clientSecretEnv).toBeTruthy()
    }
  })

  it("API key integrations do not have OAuth config", () => {
    const apiKeyIntegrations = INTEGRATIONS.filter((i) => i.authType === "api_key")
    expect(apiKeyIntegrations.length).toBeGreaterThan(0)
    for (const integration of apiKeyIntegrations) {
      expect(integration.authUrl).toBeUndefined()
      expect(integration.tokenUrl).toBeUndefined()
    }
  })

  describe("getIntegration", () => {
    it("Scenario: `getIntegration(id)` returns the record or undefined — returns the integration for a known id", () => {
      const notion = getIntegration("notion")
      expect(notion).toBeDefined()
      expect(notion!.name).toBe("Notion")
      expect(notion!.authType).toBe("api_key")
    })

    it("returns undefined for an unknown id", () => {
      expect(getIntegration("nonexistent")).toBeUndefined()
    })
  })

  describe("getOAuthIntegrations", () => {
    it("Scenario: `getOAuthIntegrations()` filters to OAuth records — returns only OAuth integrations", () => {
      const oauth = getOAuthIntegrations()
      expect(oauth.every((i) => i.authType === "oauth2")).toBe(true)
      expect(oauth.map((i) => i.id)).toContain("google")
      expect(oauth.map((i) => i.id)).toContain("pinterest")
      expect(oauth.map((i) => i.id)).toContain("quickbooks")
      // Notion, Slack, GitHub are now api_key
      expect(oauth.map((i) => i.id)).not.toContain("notion")
      expect(oauth.map((i) => i.id)).not.toContain("slack")
      expect(oauth.map((i) => i.id)).not.toContain("github")
    })
  })
})
