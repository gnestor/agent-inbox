import { vi, describe, it, expect, beforeEach } from "vitest"
import { Hono } from "hono"
import type { AppBindings } from "../../lib/workspace-context.js"

// ---------------------------------------------------------------------------
// Mock workspace-scanner — all exports used by the route file
// ---------------------------------------------------------------------------

const mockGetUserWorkspaces = vi.fn()
const mockGetWorkspaceById = vi.fn()
const mockGetWorkspaceMembers = vi.fn()
const mockAddWorkspaceMember = vi.fn()
const mockRemoveWorkspaceMember = vi.fn()
const mockUpdateWorkspaceMemberRole = vi.fn()
const mockUpdateWorkspaceName = vi.fn()
const mockGetWorkspaceGitInfo = vi.fn()
const mockIsLastAdmin = vi.fn()

vi.mock("../../lib/workspace-scanner.js", () => ({
  getUserWorkspaces: (...args: unknown[]) => mockGetUserWorkspaces(...args),
  getWorkspaceById: (...args: unknown[]) => mockGetWorkspaceById(...args),
  getWorkspaceMembers: (...args: unknown[]) => mockGetWorkspaceMembers(...args),
  addWorkspaceMember: (...args: unknown[]) => mockAddWorkspaceMember(...args),
  removeWorkspaceMember: (...args: unknown[]) => mockRemoveWorkspaceMember(...args),
  updateWorkspaceMemberRole: (...args: unknown[]) => mockUpdateWorkspaceMemberRole(...args),
  updateWorkspaceName: (...args: unknown[]) => mockUpdateWorkspaceName(...args),
  getWorkspaceGitInfo: (...args: unknown[]) => mockGetWorkspaceGitInfo(...args),
  isLastAdmin: (...args: unknown[]) => mockIsLastAdmin(...args),
}))

// ---------------------------------------------------------------------------
// Mock DB pool — used by the route for available-users and member lookup
// ---------------------------------------------------------------------------

const mockQuery = vi.fn()
const mockQueryOne = vi.fn()

vi.mock("../../db/pool.js", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  queryOne: (...args: unknown[]) => mockQueryOne(...args),
}))

// ---------------------------------------------------------------------------
// Test app setup — inject minimal workspace context
// ---------------------------------------------------------------------------

import { workspaceRoutes } from "../workspaces.js"

function createApp(role: "admin" | "member" = "admin") {
  const app = new Hono<AppBindings>()
  app.use("*", async (c, next) => {
    c.set("workspace", { id: "ws-1", name: "test", path: "/workspace", role })
    c.set("user", { name: "Test User", email: "test@example.com" })
    c.set("userEmail", "test@example.com")
    c.set("userName", "Test User")
    c.set("sessionToken", "tok")
    await next()
  })
  app.route("/workspaces", workspaceRoutes)
  return app
}

/** Helper to PUT JSON */
function putJson(app: Hono<AppBindings>, path: string, body: unknown) {
  return app.request(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

/** Helper to POST JSON */
function postJson(app: Hono<AppBindings>, path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

/** Helper to PATCH JSON */
function patchJson(app: Hono<AppBindings>, path: string, body: unknown) {
  return app.request(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

/** Helper to DELETE */
function del(app: Hono<AppBindings>, path: string) {
  return app.request(path, { method: "DELETE" })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("workspace routes", () => {
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    vi.clearAllMocks()
    app = createApp()
    // Sensible defaults
    mockGetUserWorkspaces.mockResolvedValue([])
    mockGetWorkspaceById.mockResolvedValue(null)
    mockGetWorkspaceMembers.mockResolvedValue([])
    mockIsLastAdmin.mockResolvedValue(false)
  })

  // =========================================================================
  // GET / — list workspaces
  // =========================================================================

  describe("GET /workspaces", () => {
    it("returns workspaces list for current user", async () => {
      const workspaces = [
        { id: "ws-1", name: "Workspace 1", role: "admin" },
        { id: "ws-2", name: "Workspace 2", role: "member" },
      ]
      mockGetUserWorkspaces.mockResolvedValue(workspaces)

      const res = await app.request("/workspaces")
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.workspaces).toEqual(workspaces)
      expect(data.activeWorkspaceId).toBe("ws-1")
      expect(mockGetUserWorkspaces).toHaveBeenCalledWith("test@example.com")
    })

    it("returns empty list when user has no workspaces", async () => {
      mockGetUserWorkspaces.mockResolvedValue([])

      const res = await app.request("/workspaces")
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.workspaces).toEqual([])
    })
  })

  // =========================================================================
  // PUT /active — set active workspace
  // =========================================================================

  describe("PUT /workspaces/active", () => {
    it("sets active workspace and returns workspace details", async () => {
      mockGetWorkspaceById.mockResolvedValue({ id: "ws-2", name: "My Workspace", path: "/ws2" })

      const res = await putJson(app, "/workspaces/active", { workspaceId: "ws-2" })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.id).toBe("ws-2")
      expect(data.name).toBe("My Workspace")
    })

    it("returns 404 when workspace not found", async () => {
      mockGetWorkspaceById.mockResolvedValue(null)

      const res = await putJson(app, "/workspaces/active", { workspaceId: "nonexistent" })
      expect(res.status).toBe(404)
      const data = await res.json()
      expect(data.error).toBe("Workspace not found")
    })

    it("returns 400 when workspaceId is missing", async () => {
      const res = await putJson(app, "/workspaces/active", {})
      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data.error).toBeDefined()
    })

    it("returns 400 when workspaceId is empty string", async () => {
      const res = await putJson(app, "/workspaces/active", { workspaceId: "" })
      expect(res.status).toBe(400)
    })
  })

  // =========================================================================
  // PUT /:id — rename workspace (admin only)
  // =========================================================================

  describe("PUT /workspaces/:id", () => {
    it("renames workspace successfully as admin", async () => {
      mockUpdateWorkspaceName.mockResolvedValue(true)

      const res = await putJson(app, "/workspaces/ws-1", { name: "New Name" })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.ok).toBe(true)
      expect(mockUpdateWorkspaceName).toHaveBeenCalledWith("ws-1", "New Name")
    })

    it("trims whitespace from name", async () => {
      mockUpdateWorkspaceName.mockResolvedValue(true)

      const res = await putJson(app, "/workspaces/ws-1", { name: "  Trimmed  " })
      expect(res.status).toBe(200)
      expect(mockUpdateWorkspaceName).toHaveBeenCalledWith("ws-1", "Trimmed")
    })

    it("returns 403 for non-admin user", async () => {
      const memberApp = createApp("member")
      const res = await putJson(memberApp, "/workspaces/ws-1", { name: "New" })
      expect(res.status).toBe(403)
    })

    it("returns 400 when name is missing", async () => {
      const res = await putJson(app, "/workspaces/ws-1", {})
      expect(res.status).toBe(400)
    })

    it("returns 400 when name is empty string", async () => {
      const res = await putJson(app, "/workspaces/ws-1", { name: "" })
      expect(res.status).toBe(400)
    })

    it("returns 404 when updateWorkspaceName returns falsy", async () => {
      mockUpdateWorkspaceName.mockResolvedValue(null)

      const res = await putJson(app, "/workspaces/ws-99", { name: "Test" })
      expect(res.status).toBe(404)
      const data = await res.json()
      expect(data.error).toBe("Workspace not found")
    })
  })

  // =========================================================================
  // GET /:id — workspace details with members (admin only)
  // =========================================================================

  describe("GET /workspaces/:id", () => {
    it("returns workspace details with members", async () => {
      mockGetWorkspaceById.mockResolvedValue({ id: "ws-1", name: "Test WS", path: "/ws" })
      mockGetWorkspaceMembers.mockResolvedValue([
        { user_email: "admin@test.com", role: "admin", name: "Admin" },
        { user_email: "member@test.com", role: "member", name: "Member" },
      ])

      const res = await app.request("/workspaces/ws-1")
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.workspace.id).toBe("ws-1")
      expect(data.members).toHaveLength(2)
    })

    it("returns 404 when workspace not found", async () => {
      mockGetWorkspaceById.mockResolvedValue(null)

      const res = await app.request("/workspaces/ws-99")
      expect(res.status).toBe(404)
      const data = await res.json()
      expect(data.error).toBe("Workspace not found")
    })

    it("returns 403 for non-admin user", async () => {
      const memberApp = createApp("member")
      const res = await memberApp.request("/workspaces/ws-1")
      expect(res.status).toBe(403)
    })
  })

  // =========================================================================
  // POST /:id/members — add member (admin only)
  // =========================================================================

  describe("POST /workspaces/:id/members", () => {
    it("adds a member successfully", async () => {
      mockGetWorkspaceById.mockResolvedValue({ id: "ws-1", name: "Test", path: "/ws" })
      mockQueryOne.mockResolvedValue({ email: "new@test.com" })
      mockAddWorkspaceMember.mockResolvedValue(undefined)

      const res = await postJson(app, "/workspaces/ws-1/members", {
        email: "new@test.com",
        role: "member",
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.ok).toBe(true)
      expect(mockAddWorkspaceMember).toHaveBeenCalledWith("ws-1", "new@test.com", "member")
    })

    it("defaults role to member when not specified", async () => {
      mockGetWorkspaceById.mockResolvedValue({ id: "ws-1", name: "Test", path: "/ws" })
      mockQueryOne.mockResolvedValue({ email: "new@test.com" })
      mockAddWorkspaceMember.mockResolvedValue(undefined)

      const res = await postJson(app, "/workspaces/ws-1/members", {
        email: "new@test.com",
      })
      expect(res.status).toBe(200)
      expect(mockAddWorkspaceMember).toHaveBeenCalledWith("ws-1", "new@test.com", "member")
    })

    it("returns 400 when email is missing", async () => {
      mockGetWorkspaceById.mockResolvedValue({ id: "ws-1", name: "Test", path: "/ws" })

      const res = await postJson(app, "/workspaces/ws-1/members", {})
      expect(res.status).toBe(400)
    })

    it("returns 400 when email is invalid", async () => {
      mockGetWorkspaceById.mockResolvedValue({ id: "ws-1", name: "Test", path: "/ws" })

      const res = await postJson(app, "/workspaces/ws-1/members", { email: "not-an-email" })
      expect(res.status).toBe(400)
    })

    it("returns 404 when workspace not found", async () => {
      mockGetWorkspaceById.mockResolvedValue(null)

      const res = await postJson(app, "/workspaces/ws-1/members", { email: "new@test.com" })
      expect(res.status).toBe(404)
      const data = await res.json()
      expect(data.error).toBe("Workspace not found")
    })

    it("returns 404 when user not found in users table", async () => {
      mockGetWorkspaceById.mockResolvedValue({ id: "ws-1", name: "Test", path: "/ws" })
      mockQueryOne.mockResolvedValue(null)

      const res = await postJson(app, "/workspaces/ws-1/members", { email: "unknown@test.com" })
      expect(res.status).toBe(404)
      const data = await res.json()
      expect(data.error).toBe("User not found")
    })

    it("returns 403 for non-admin user", async () => {
      const memberApp = createApp("member")
      const res = await postJson(memberApp, "/workspaces/ws-1/members", {
        email: "new@test.com",
      })
      expect(res.status).toBe(403)
    })
  })

  // =========================================================================
  // PATCH /:id/members/:email — update member role
  // =========================================================================

  describe("PATCH /workspaces/:id/members/:email", () => {
    it("updates member role successfully", async () => {
      mockUpdateWorkspaceMemberRole.mockResolvedValue(true)

      const res = await patchJson(app, "/workspaces/ws-1/members/user@test.com", {
        role: "admin",
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.ok).toBe(true)
      expect(mockUpdateWorkspaceMemberRole).toHaveBeenCalledWith("ws-1", "user@test.com", "admin")
    })

    it("returns 400 when role is missing", async () => {
      const res = await patchJson(app, "/workspaces/ws-1/members/user@test.com", {})
      expect(res.status).toBe(400)
    })

    it("returns 400 when role is invalid", async () => {
      const res = await patchJson(app, "/workspaces/ws-1/members/user@test.com", {
        role: "superadmin",
      })
      expect(res.status).toBe(400)
    })

    it("returns 400 when demoting the last admin", async () => {
      mockIsLastAdmin.mockResolvedValue(true)

      const res = await patchJson(app, "/workspaces/ws-1/members/admin@test.com", {
        role: "member",
      })
      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data.error).toBe("Cannot demote the last admin")
    })

    it("allows promoting a member to admin even if they are the last admin", async () => {
      // Promoting to admin should NOT trigger the last-admin check
      mockIsLastAdmin.mockResolvedValue(true)
      mockUpdateWorkspaceMemberRole.mockResolvedValue(true)

      const res = await patchJson(app, "/workspaces/ws-1/members/admin@test.com", {
        role: "admin",
      })
      expect(res.status).toBe(200)
      // isLastAdmin check only fires when role === "member"
      expect(mockIsLastAdmin).not.toHaveBeenCalled()
    })

    it("returns 404 when member not found", async () => {
      mockUpdateWorkspaceMemberRole.mockResolvedValue(false)

      const res = await patchJson(app, "/workspaces/ws-1/members/missing@test.com", {
        role: "admin",
      })
      expect(res.status).toBe(404)
      const data = await res.json()
      expect(data.error).toBe("Member not found")
    })

    it("returns 403 for non-admin user", async () => {
      const memberApp = createApp("member")
      const res = await patchJson(memberApp, "/workspaces/ws-1/members/user@test.com", {
        role: "admin",
      })
      expect(res.status).toBe(403)
    })
  })

  // =========================================================================
  // DELETE /:id/members/:email — remove member
  // =========================================================================

  describe("DELETE /workspaces/:id/members/:email", () => {
    it("removes a member successfully", async () => {
      mockIsLastAdmin.mockResolvedValue(false)
      mockRemoveWorkspaceMember.mockResolvedValue(true)

      const res = await del(app, "/workspaces/ws-1/members/user@test.com")
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.ok).toBe(true)
      expect(mockRemoveWorkspaceMember).toHaveBeenCalledWith("ws-1", "user@test.com")
    })

    it("returns 400 when trying to remove the last admin", async () => {
      mockIsLastAdmin.mockResolvedValue(true)

      const res = await del(app, "/workspaces/ws-1/members/admin@test.com")
      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data.error).toBe("Cannot remove the last admin")
    })

    it("returns 404 when member not found", async () => {
      mockIsLastAdmin.mockResolvedValue(false)
      mockRemoveWorkspaceMember.mockResolvedValue(false)

      const res = await del(app, "/workspaces/ws-1/members/missing@test.com")
      expect(res.status).toBe(404)
      const data = await res.json()
      expect(data.error).toBe("Member not found")
    })

    it("returns 403 for non-admin user", async () => {
      const memberApp = createApp("member")
      const res = await del(memberApp, "/workspaces/ws-1/members/user@test.com")
      expect(res.status).toBe(403)
    })
  })

  // =========================================================================
  // GET /:id/git — git info (admin only)
  // =========================================================================

  describe("GET /workspaces/:id/git", () => {
    it("returns git info for workspace", async () => {
      mockGetWorkspaceById.mockResolvedValue({ id: "ws-1", name: "Test", path: "/workspace" })
      mockGetWorkspaceGitInfo.mockReturnValue({ branch: "main", remote: "origin" })

      const res = await app.request("/workspaces/ws-1/git")
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.branch).toBe("main")
      expect(mockGetWorkspaceGitInfo).toHaveBeenCalledWith("/workspace")
    })

    it("returns 404 when workspace not found", async () => {
      mockGetWorkspaceById.mockResolvedValue(null)

      const res = await app.request("/workspaces/ws-1/git")
      expect(res.status).toBe(404)
    })

    it("returns 403 for non-admin user", async () => {
      const memberApp = createApp("member")
      const res = await memberApp.request("/workspaces/ws-1/git")
      expect(res.status).toBe(403)
    })
  })

  // =========================================================================
  // GET /:id/available-users — list users not in workspace
  // =========================================================================

  describe("GET /workspaces/:id/available-users", () => {
    it("returns users not in the workspace", async () => {
      mockQuery.mockResolvedValue([
        { email: "avail@test.com", name: "Available User", picture: null },
      ])

      const res = await app.request("/workspaces/ws-1/available-users")
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.users).toHaveLength(1)
      expect(data.users[0].email).toBe("avail@test.com")
    })

    it("returns 403 for non-admin user", async () => {
      const memberApp = createApp("member")
      const res = await memberApp.request("/workspaces/ws-1/available-users")
      expect(res.status).toBe(403)
    })
  })
})
