import { vi, describe, it, expect, beforeEach } from "vitest"

// --- In-memory stores for the mock DB layer ---

let workspacesStore: Record<string, any> = {}
let membersStore: Array<any> = []
let usersStore: Array<any> = []

const mockQuery = vi.fn<(...args: any[]) => Promise<any[]>>()
const mockQueryOne = vi.fn<(...args: any[]) => Promise<any | undefined>>()
const mockExecute = vi.fn<(...args: any[]) => Promise<{ rowCount: number }>>()

vi.mock("../../db/pool.js", () => ({
  query: (...args: any[]) => mockQuery(...args),
  queryOne: (...args: any[]) => mockQueryOne(...args),
  execute: (...args: any[]) => mockExecute(...args),
}))

// Mock child_process so deriveWorkspaceName doesn't shell out
vi.mock("child_process", () => ({
  execFileSync: vi.fn(() => {
    throw new Error("no git")
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  workspacesStore = {}
  membersStore = []
  usersStore = []

  // Reset module-level `claimedUsers` set between tests
  vi.resetModules()
})

// Helper: import fresh module per test to avoid stale claimedUsers cache
async function importModule() {
  return await import("../workspace-scanner.js")
}

// ─── getAllWorkspaces ───────────────────────────────────────────────────

describe("getAllWorkspaces", () => {
  it("returns all workspaces from DB", async () => {
    const rows = [
      { id: "ws-1", name: "Project A", path: "/a", created_at: "2026-01-01", updated_at: "2026-01-01" },
      { id: "ws-2", name: "Project B", path: "/b", created_at: "2026-01-01", updated_at: "2026-01-01" },
    ]
    mockQuery.mockResolvedValueOnce(rows)

    const { getAllWorkspaces } = await importModule()
    const result = await getAllWorkspaces()

    expect(result).toEqual(rows)
    expect(mockQuery).toHaveBeenCalledWith("SELECT * FROM workspaces ORDER BY name")
  })

  it("returns empty array when no workspaces exist", async () => {
    mockQuery.mockResolvedValueOnce([])

    const { getAllWorkspaces } = await importModule()
    const result = await getAllWorkspaces()

    expect(result).toEqual([])
  })
})

// ─── getWorkspaceById ──────────────────────────────────────────────────

describe("getWorkspaceById", () => {
  it("returns a single workspace by ID", async () => {
    const ws = { id: "ws-1", name: "Project A", path: "/a", created_at: "2026-01-01", updated_at: "2026-01-01" }
    mockQueryOne.mockResolvedValueOnce(ws)

    const { getWorkspaceById } = await importModule()
    const result = await getWorkspaceById("ws-1")

    expect(result).toEqual(ws)
    expect(mockQueryOne).toHaveBeenCalledWith("SELECT * FROM workspaces WHERE id = $1", ["ws-1"])
  })

  it("returns undefined for a missing workspace", async () => {
    mockQueryOne.mockResolvedValueOnce(null)

    const { getWorkspaceById } = await importModule()
    const result = await getWorkspaceById("nonexistent")

    expect(result).toBeUndefined()
  })
})

// ─── getUserWorkspaces ─────────────────────────────────────────────────

describe("getUserWorkspaces", () => {
  it("returns workspaces for a specific user email with role", async () => {
    const rows = [
      { id: "ws-1", name: "Project A", path: "/a", role: "admin", created_at: "2026-01-01", updated_at: "2026-01-01" },
    ]
    mockQuery.mockResolvedValueOnce(rows)

    const { getUserWorkspaces } = await importModule()
    const result = await getUserWorkspaces("alice@example.com")

    expect(result).toEqual(rows)
    expect(result[0]!.role).toBe("admin")
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("JOIN workspace_members"),
      ["alice@example.com"],
    )
  })

  it("returns empty array when user has no workspaces", async () => {
    mockQuery.mockResolvedValueOnce([])

    const { getUserWorkspaces } = await importModule()
    const result = await getUserWorkspaces("nobody@example.com")

    expect(result).toEqual([])
  })
})

// ─── getWorkspaceMembers ───────────────────────────────────────────────

describe("getWorkspaceMembers", () => {
  it("returns members with name and picture", async () => {
    const rows = [
      { workspace_id: "ws-1", user_email: "alice@example.com", role: "admin", name: "Alice", picture: "https://img/alice.jpg", created_at: "2026-01-01" },
      { workspace_id: "ws-1", user_email: "bob@example.com", role: "member", name: "Bob", picture: undefined, created_at: "2026-01-01" },
    ]
    mockQuery.mockResolvedValueOnce(rows)

    const { getWorkspaceMembers } = await importModule()
    const result = await getWorkspaceMembers("ws-1")

    expect(result).toHaveLength(2)
    expect(result[0]!.name).toBe("Alice")
    expect(result[0]!.picture).toBe("https://img/alice.jpg")
    expect(result[1]!.picture).toBeUndefined()
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("JOIN users"),
      ["ws-1"],
    )
  })
})

// ─── addWorkspaceMember ────────────────────────────────────────────────

describe("addWorkspaceMember", () => {
  it("inserts a new member with default role", async () => {
    mockExecute.mockResolvedValueOnce({ rowCount: 1 })

    const { addWorkspaceMember } = await importModule()
    await addWorkspaceMember("ws-1", "alice@example.com")

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO workspace_members"),
      ["ws-1", "alice@example.com", "member", expect.any(String)],
    )
  })

  it("inserts a member with explicit admin role", async () => {
    mockExecute.mockResolvedValueOnce({ rowCount: 1 })

    const { addWorkspaceMember } = await importModule()
    await addWorkspaceMember("ws-1", "alice@example.com", "admin")

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO workspace_members"),
      ["ws-1", "alice@example.com", "admin", expect.any(String)],
    )
  })
})

// ─── removeWorkspaceMember ─────────────────────────────────────────────

describe("removeWorkspaceMember", () => {
  it("deletes a member and returns true on success", async () => {
    mockExecute.mockResolvedValueOnce({ rowCount: 1 })

    const { removeWorkspaceMember } = await importModule()
    const result = await removeWorkspaceMember("ws-1", "alice@example.com")

    expect(result).toBe(true)
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM workspace_members"),
      ["ws-1", "alice@example.com"],
    )
  })

  it("returns false when member does not exist", async () => {
    mockExecute.mockResolvedValueOnce({ rowCount: 0 })

    const { removeWorkspaceMember } = await importModule()
    const result = await removeWorkspaceMember("ws-1", "nobody@example.com")

    expect(result).toBe(false)
  })
})

// ─── updateWorkspaceMemberRole ─────────────────────────────────────────

describe("updateWorkspaceMemberRole", () => {
  it("updates role and returns true", async () => {
    mockExecute.mockResolvedValueOnce({ rowCount: 1 })

    const { updateWorkspaceMemberRole } = await importModule()
    const result = await updateWorkspaceMemberRole("ws-1", "alice@example.com", "admin")

    expect(result).toBe(true)
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE workspace_members SET role"),
      ["admin", "ws-1", "alice@example.com"],
    )
  })

  it("returns false when member not found", async () => {
    mockExecute.mockResolvedValueOnce({ rowCount: 0 })

    const { updateWorkspaceMemberRole } = await importModule()
    const result = await updateWorkspaceMemberRole("ws-1", "nobody@example.com", "admin")

    expect(result).toBe(false)
  })
})

// ─── getWorkspaceMemberRole ────────────────────────────────────────────

describe("getWorkspaceMemberRole", () => {
  it("returns the role when user is a member", async () => {
    mockQueryOne.mockResolvedValueOnce({ role: "admin" })

    const { getWorkspaceMemberRole } = await importModule()
    const result = await getWorkspaceMemberRole("ws-1", "alice@example.com")

    expect(result).toBe("admin")
  })

  it("returns null when user is not a member", async () => {
    mockQueryOne.mockResolvedValueOnce(undefined)

    const { getWorkspaceMemberRole } = await importModule()
    const result = await getWorkspaceMemberRole("ws-1", "nobody@example.com")

    expect(result).toBeNull()
  })
})

// ─── isLastAdmin ───────────────────────────────────────────────────────

describe("isLastAdmin", () => {
  it("returns true when no other admins exist", async () => {
    mockQueryOne.mockResolvedValueOnce({ count: "0" })

    const { isLastAdmin } = await importModule()
    const result = await isLastAdmin("ws-1", "alice@example.com")

    expect(result).toBe(true)
  })

  it("returns false when other admins exist", async () => {
    mockQueryOne.mockResolvedValueOnce({ count: "2" })

    const { isLastAdmin } = await importModule()
    const result = await isLastAdmin("ws-1", "alice@example.com")

    expect(result).toBe(false)
  })
})

// ─── updateWorkspaceName ───────────────────────────────────────────────

describe("updateWorkspaceName", () => {
  it("returns true when workspace is updated", async () => {
    mockExecute.mockResolvedValueOnce({ rowCount: 1 })

    const { updateWorkspaceName } = await importModule()
    const result = await updateWorkspaceName("ws-1", "New Name")

    expect(result).toBe(true)
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE workspaces SET name"),
      ["New Name", expect.any(String), "ws-1"],
    )
  })

  it("returns false when workspace not found", async () => {
    mockExecute.mockResolvedValueOnce({ rowCount: 0 })

    const { updateWorkspaceName } = await importModule()
    const result = await updateWorkspaceName("nonexistent", "Name")

    expect(result).toBe(false)
  })
})

// ─── ensureWorkspaceAccess ─────────────────────────────────────────────

describe("ensureWorkspaceAccess", () => {
  it("returns existing role when user is already a member", async () => {
    // getWorkspaceMemberRole will call queryOne
    mockQueryOne.mockResolvedValueOnce({ role: "member" })

    const { ensureWorkspaceAccess } = await importModule()
    const result = await ensureWorkspaceAccess("ws-1", "alice@example.com")

    expect(result).toBe("member")
  })

  it("auto-claims as admin when workspace has no members", async () => {
    // getWorkspaceMemberRole → null
    mockQueryOne.mockResolvedValueOnce(undefined)
    // count query → 0 members
    mockQueryOne.mockResolvedValueOnce({ count: "0" })
    // addWorkspaceMember → execute
    mockExecute.mockResolvedValueOnce({ rowCount: 1 })

    const { ensureWorkspaceAccess } = await importModule()
    const result = await ensureWorkspaceAccess("ws-1", "newuser@example.com")

    expect(result).toBe("admin")
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO workspace_members"),
      expect.arrayContaining(["ws-1", "newuser@example.com", "admin"]),
    )
  })

  it("returns null when workspace has members and user is not one", async () => {
    // getWorkspaceMemberRole → null
    mockQueryOne.mockResolvedValueOnce(undefined)
    // count query → 2 existing members
    mockQueryOne.mockResolvedValueOnce({ count: "2" })

    const { ensureWorkspaceAccess } = await importModule()
    const result = await ensureWorkspaceAccess("ws-1", "outsider@example.com")

    expect(result).toBeNull()
  })
})

// ─── registerWorkspaces ────────────────────────────────────────────────

describe("registerWorkspaces", () => {
  it("upserts workspaces and cleans stale entries", async () => {
    // For each path: one execute (upsert)
    mockExecute.mockResolvedValue({ rowCount: 1 })
    // Final query to return all workspaces
    mockQuery.mockResolvedValueOnce([
      { id: "project-a", name: "project-a", path: "/repos/project-a", created_at: "2026-01-01", updated_at: "2026-01-01" },
    ])

    const { registerWorkspaces } = await importModule()
    const result = await registerWorkspaces(["/repos/project-a"])

    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe("project-a")
    // upsert + delete members + delete workspaces = 3 execute calls
    expect(mockExecute).toHaveBeenCalledTimes(3)
    // First call should be the INSERT/upsert
    expect(mockExecute.mock.calls[0]![0]).toContain("INSERT INTO workspaces")
    // Second and third are cleanup DELETEs
    expect(mockExecute.mock.calls[1]![0]).toContain("DELETE FROM workspace_members")
    expect(mockExecute.mock.calls[2]![0]).toContain("DELETE FROM workspaces")
  })

  it("handles empty paths array", async () => {
    mockQuery.mockResolvedValueOnce([])

    const { registerWorkspaces } = await importModule()
    const result = await registerWorkspaces([])

    expect(result).toEqual([])
    // No upserts, no deletes, just the final query
    expect(mockExecute).not.toHaveBeenCalled()
  })
})

// ─── deriveWorkspaceName ───────────────────────────────────────────────

describe("deriveWorkspaceName", () => {
  it("falls back to basename when git remote fails", async () => {
    const { deriveWorkspaceName } = await importModule()
    const result = deriveWorkspaceName("/home/user/projects/my-app")

    expect(result).toBe("my-app")
  })

  it("extracts repo name from git remote URL when available", async () => {
    const { execFileSync } = await import("child_process")
    vi.mocked(execFileSync).mockReturnValueOnce("https://github.com/org/cool-repo.git\n")

    const { deriveWorkspaceName } = await importModule()
    const result = deriveWorkspaceName("/some/path")

    expect(result).toBe("cool-repo")
  })
})

// ─── resolveActiveWorkspace ────────────────────────────────────────────

describe("resolveActiveWorkspace", () => {
  it("returns cookie workspace when user is a member", async () => {
    const ws = { id: "ws-1", name: "Project", path: "/a", created_at: "2026-01-01", updated_at: "2026-01-01" }

    // claimUnclaimedWorkspaces → getAllWorkspaces
    mockQuery.mockResolvedValueOnce([])
    // getWorkspaceMemberRole for cookie workspace
    mockQueryOne.mockResolvedValueOnce({ role: "admin" })
    // getWorkspaceById
    mockQueryOne.mockResolvedValueOnce(ws)

    const { resolveActiveWorkspace } = await importModule()
    const result = await resolveActiveWorkspace("alice@example.com", "ws-1")

    expect(result).toMatchObject({ id: "ws-1", role: "admin" })
  })

  it("falls back to first user workspace when cookie workspace is invalid", async () => {
    const userWs = [{ id: "ws-2", name: "Fallback", path: "/b", role: "member", created_at: "2026-01-01", updated_at: "2026-01-01" }]

    // claimUnclaimedWorkspaces → getAllWorkspaces
    mockQuery.mockResolvedValueOnce([])
    // getWorkspaceMemberRole for cookie → not a member
    mockQueryOne.mockResolvedValueOnce(undefined)
    // getUserWorkspaces
    mockQuery.mockResolvedValueOnce(userWs)

    const { resolveActiveWorkspace } = await importModule()
    const result = await resolveActiveWorkspace("alice@example.com", "bad-ws")

    expect(result).toMatchObject({ id: "ws-2", role: "member" })
  })

  it("returns null when user has no workspaces", async () => {
    // claimUnclaimedWorkspaces → getAllWorkspaces
    mockQuery.mockResolvedValueOnce([])
    // getUserWorkspaces → empty
    mockQuery.mockResolvedValueOnce([])

    const { resolveActiveWorkspace } = await importModule()
    const result = await resolveActiveWorkspace("alice@example.com", undefined)

    expect(result).toBeNull()
  })
})
