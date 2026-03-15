import { describe, it, expect } from "vitest"
import { INTEGRATIONS, getIntegration, getOAuthIntegrations } from "../integrations.js"

describe("integration registry", () => {
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
    it("returns the integration for a known id", () => {
      const notion = getIntegration("notion")
      expect(notion).toBeDefined()
      expect(notion!.name).toBe("Notion")
      expect(notion!.authType).toBe("oauth2")
    })

    it("returns undefined for an unknown id", () => {
      expect(getIntegration("nonexistent")).toBeUndefined()
    })
  })

  describe("getOAuthIntegrations", () => {
    it("returns only OAuth integrations", () => {
      const oauth = getOAuthIntegrations()
      expect(oauth.every((i) => i.authType === "oauth2")).toBe(true)
      expect(oauth.map((i) => i.id)).toContain("notion")
      expect(oauth.map((i) => i.id)).toContain("slack")
      expect(oauth.map((i) => i.id)).toContain("github")
      expect(oauth.map((i) => i.id)).not.toContain("shopify")
      expect(oauth.map((i) => i.id)).not.toContain("air")
    })
  })
})
