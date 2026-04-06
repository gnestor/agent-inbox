import { test, expect } from "@playwright/test"

test.describe("Health check (integration)", () => {
  test("GET /api/health returns ok with structured status", async ({ request }) => {
    const res = await request.get("http://localhost:3002/api/health")
    expect(res.status()).toBe(200)

    const body = await res.json()
    expect(body.status).toBe("ok")
    expect(body.timestamp).toBeTruthy()

    // Database check
    expect(body.database).toBeDefined()
    expect(body.database.status).toBe("ok")
    expect(typeof body.database.latencyMs).toBe("number")

    // Vault check
    expect(body.vault).toBeDefined()
    expect(body.vault.status).toBe("ok")

    // Plugins check
    expect(body.plugins).toBeDefined()
    expect(body.plugins.status).toBe("ok")
    expect(typeof body.plugins.count).toBe("number")
  })
})
