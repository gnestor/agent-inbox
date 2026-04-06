import { test, expect } from "@playwright/test"
import { seedTestData } from "../helpers/db-setup"

test.describe("Workspace management (integration)", () => {
  test.beforeAll(async () => {
    await seedTestData()
  })

  test("GET /api/workspaces returns workspace list", async ({ request }) => {
    const res = await request.get("/api/workspaces")
    expect(res.ok()).toBe(true)

    const body = await res.json()
    expect(body.workspaces).toBeDefined()
    expect(Array.isArray(body.workspaces)).toBe(true)
    // Seeded workspace should be present
    const ws = body.workspaces.find((w: { name: string }) => w.name === "Test Workspace")
    expect(ws).toBeDefined()
  })

  test("PUT /api/workspaces/:id renames workspace", async ({ request }) => {
    const renameRes = await request.put("/api/workspaces/test-ws", {
      headers: {
        "Content-Type": "application/json",
        "Origin": "http://localhost:5175",
      },
      data: { name: "Renamed Workspace" },
    })
    expect(renameRes.ok()).toBe(true)

    // Verify the rename persisted
    const listRes = await request.get("/api/workspaces")
    const body = await listRes.json()
    const ws = body.workspaces.find((w: { id: string }) => w.id === "test-ws")
    expect(ws?.name).toBe("Renamed Workspace")
  })

  test("PUT /api/workspaces/active sets the active workspace cookie", async ({ request }) => {
    const res = await request.put("/api/workspaces/active", {
      headers: {
        "Content-Type": "application/json",
        "Origin": "http://localhost:5175",
      },
      data: { workspaceId: "test-ws" },
    })
    expect(res.ok()).toBe(true)

    const body = await res.json()
    expect(body.id).toBe("test-ws")
  })
})
