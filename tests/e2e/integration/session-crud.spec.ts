import { test, expect } from "@playwright/test"
import { seedTestData } from "../helpers/db-setup"

test.describe("Session CRUD (integration)", () => {
  test.beforeAll(async () => {
    await seedTestData()
  })

  test("session list loads and shows seeded sessions", async ({ page }) => {
    // This test requires the full Vite client — skip if only Hono server is running
    test.skip(!process.env.VITE_CLIENT, "Requires Vite client (npm run dev)")
    await page.goto("/sessions")
    await expect(page.getByText("Feature built successfully")).toBeVisible({ timeout: 15_000 })
  })

  test("clicking a session opens the detail panel", async ({ page }) => {
    test.skip(!process.env.VITE_CLIENT, "Requires Vite client (npm run dev)")
    await page.goto("/sessions")
    const sessionItem = page.getByText("Feature built successfully")
    await expect(sessionItem).toBeVisible({ timeout: 15_000 })
    await sessionItem.click()
    await expect(page.getByText("Build a feature")).toBeVisible({ timeout: 10_000 })
  })

  test("rename session via API persists", async ({ request }) => {
    // Rename via API
    const patchRes = await request.patch("/api/sessions/e2e-session-complete", {
      headers: {
        "Content-Type": "application/json",
        "Origin": "http://localhost:5175",
      },
      data: { summary: "Renamed E2E Session" },
    })
    expect(patchRes.ok()).toBe(true)

    // Verify it persists by fetching
    const getRes = await request.get("/api/sessions/e2e-session-complete")
    expect(getRes.ok()).toBe(true)
    const body = await getRes.json()
    expect(body.session.summary).toBe("Renamed E2E Session")
  })

  test("archive session via API then verify it is archived", async ({ request }) => {
    const archiveRes = await request.post("/api/sessions/e2e-session-complete/archive", {
      headers: { "Origin": "http://localhost:5175" },
    })
    expect(archiveRes.ok()).toBe(true)

    // Verify status is now archived
    const getRes = await request.get("/api/sessions/e2e-session-complete")
    const body = await getRes.json()
    expect(body.session.status).toBe("archived")
  })

  test("unarchive session via API", async ({ request }) => {
    // Ensure the session is archived first (previous test may have run)
    await request.post("/api/sessions/e2e-session-complete/archive", {
      headers: { "Origin": "http://localhost:5175" },
    })

    const unarchiveRes = await request.post("/api/sessions/e2e-session-complete/unarchive", {
      headers: { "Origin": "http://localhost:5175" },
    })
    expect(unarchiveRes.ok()).toBe(true)

    const getRes = await request.get("/api/sessions/e2e-session-complete")
    const body = await getRes.json()
    expect(body.session.status).toBe("complete")
  })
})
