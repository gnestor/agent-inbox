import { basename } from "path"
import { execFileSync } from "child_process"
import { query, queryOne, execute } from "../db/pool.js"
import { createLogger } from "@hammies/frontend/lib/serverLogger"

const log = createLogger("workspace")

export interface WorkspaceRow {
  id: string
  name: string
  path: string
  created_at: string
  updated_at: string
}

export interface WorkspaceMemberRow {
  workspace_id: string
  user_email: string
  role: "admin" | "member"
  created_at: string
}

/** Derive a display name for a workspace directory from its git remote or basename. */
export function deriveWorkspaceName(dirPath: string): string {
  try {
    const remoteUrl = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: dirPath,
      encoding: "utf-8",
    }).trim()
    return remoteUrl.replace(/\.git$/, "").split("/").pop() || basename(dirPath)
  } catch {
    return basename(dirPath)
  }
}

/**
 * Register an explicit list of workspace directory paths.
 * Each path is upserted into the workspaces table.
 * Returns the list of registered workspaces.
 */
export async function registerWorkspaces(paths: string[]): Promise<WorkspaceRow[]> {
  const now = new Date().toISOString()

  const upsertSql = `
    INSERT INTO workspaces (id, name, path, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT(id) DO UPDATE SET path = EXCLUDED.path, updated_at = EXCLUDED.updated_at`

  const ids: string[] = []
  for (const wsPath of paths) {
    const id = basename(wsPath)
    const name = deriveWorkspaceName(wsPath)
    await execute(upsertSql, [id, name, wsPath, now, now])
    ids.push(id)
  }

  // Remove stale workspaces not in the current list
  if (ids.length > 0) {
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(",")
    await execute(`DELETE FROM workspace_members WHERE workspace_id NOT IN (${placeholders})`, ids)
    await execute(`DELETE FROM workspaces WHERE id NOT IN (${placeholders})`, ids)
  }

  claimedUsers.clear() // new workspaces may need claiming
  log.info("Registered workspaces", { count: paths.length })
  return await query<WorkspaceRow>("SELECT * FROM workspaces")
}

/** Update a workspace's display name. */
export async function updateWorkspaceName(id: string, name: string): Promise<boolean> {
  const now = new Date().toISOString()
  const result = await execute(
    "UPDATE workspaces SET name = $1, updated_at = $2 WHERE id = $3",
    [name, now, id],
  )
  return result.rowCount > 0
}

/** Get all workspaces from the DB. */
export function getAllWorkspaces(): Promise<WorkspaceRow[]> {
  return query<WorkspaceRow>("SELECT * FROM workspaces ORDER BY name")
}

/** Get a workspace by ID. */
export async function getWorkspaceById(id: string): Promise<WorkspaceRow | undefined> {
  return (await queryOne<WorkspaceRow>("SELECT * FROM workspaces WHERE id = $1", [id])) ?? undefined
}

/** Get workspaces that a user is a member of. */
export function getUserWorkspaces(email: string): Promise<Array<WorkspaceRow & { role: string }>> {
  return query<WorkspaceRow & { role: string }>(
    `SELECT w.*, wm.role FROM workspaces w
     JOIN workspace_members wm ON wm.workspace_id = w.id
     WHERE wm.user_email = $1
     ORDER BY w.name`,
    [email],
  )
}

/** Get members of a workspace. */
export function getWorkspaceMembers(workspaceId: string): Promise<Array<WorkspaceMemberRow & { name: string; picture?: string }>> {
  return query<WorkspaceMemberRow & { name: string; picture?: string }>(
    `SELECT wm.*, u.name, u.picture FROM workspace_members wm
     JOIN users u ON u.email = wm.user_email
     WHERE wm.workspace_id = $1
     ORDER BY wm.role DESC, u.name`,
    [workspaceId],
  )
}

/** Add a member to a workspace. */
export async function addWorkspaceMember(workspaceId: string, email: string, role: "admin" | "member" = "member"): Promise<void> {
  const now = new Date().toISOString()
  await execute(
    `INSERT INTO workspace_members (workspace_id, user_email, role, created_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [workspaceId, email, role, now],
  )
}

/** Remove a member from a workspace. */
export async function removeWorkspaceMember(workspaceId: string, email: string): Promise<boolean> {
  const result = await execute(
    "DELETE FROM workspace_members WHERE workspace_id = $1 AND user_email = $2",
    [workspaceId, email],
  )
  return result.rowCount > 0
}

/** Update a member's role. */
export async function updateWorkspaceMemberRole(workspaceId: string, email: string, role: "admin" | "member"): Promise<boolean> {
  const result = await execute(
    "UPDATE workspace_members SET role = $1 WHERE workspace_id = $2 AND user_email = $3",
    [role, workspaceId, email],
  )
  return result.rowCount > 0
}

/** Get a user's role in a workspace, or null if not a member. */
export async function getWorkspaceMemberRole(workspaceId: string, email: string): Promise<"admin" | "member" | null> {
  const row = await queryOne<{ role: string }>(
    "SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_email = $2",
    [workspaceId, email],
  )
  return (row?.role as "admin" | "member") ?? null
}

/**
 * Ensure a user has access to a workspace.
 * If the workspace has no members, the first user becomes admin (auto-claim).
 * Returns the user's role, or null if access denied.
 */
export async function ensureWorkspaceAccess(workspaceId: string, email: string): Promise<"admin" | "member" | null> {
  const existing = await getWorkspaceMemberRole(workspaceId, email)
  if (existing) return existing

  // Auto-claim: if workspace has no members, first user becomes admin
  const countRow = await queryOne<{ count: string }>(
    "SELECT COUNT(*) as count FROM workspace_members WHERE workspace_id = $1",
    [workspaceId],
  )

  if (parseInt(countRow?.count || "0", 10) === 0) {
    await addWorkspaceMember(workspaceId, email, "admin")
    log.info("Auto-assigned admin role", { email, workspaceId })
    return "admin"
  }

  return null
}

/** Returns true if removing/demoting `email` would leave the workspace with no admins. */
export async function isLastAdmin(workspaceId: string, email: string): Promise<boolean> {
  const row = await queryOne<{ count: string }>(
    "SELECT COUNT(*)::int AS count FROM workspace_members WHERE workspace_id = $1 AND role = 'admin' AND user_email != $2",
    [workspaceId, email],
  )
  return parseInt(row?.count || "0", 10) === 0
}

// Track which users have already been through the auto-claim pass this process lifetime
const claimedUsers = new Set<string>()

/**
 * Auto-claim all unclaimed workspaces for a user (first user becomes admin).
 * Only runs once per user per process lifetime — subsequent calls are no-ops.
 */
async function claimUnclaimedWorkspaces(email: string): Promise<void> {
  if (claimedUsers.has(email)) return
  const allWs = await getAllWorkspaces()
  for (const ws of allWs) {
    await ensureWorkspaceAccess(ws.id, email)
  }
  claimedUsers.add(email)
}

/** Reset the claim cache (e.g. when workspaces are added/removed). */
export function resetClaimCache(): void {
  claimedUsers.clear()
}

/**
 * Resolve the active workspace for a user.
 * Priority: cookie workspace → first user workspace.
 * Also claims any unclaimed workspaces as a side effect (once per process).
 */
export async function resolveActiveWorkspace(
  email: string,
  cookieWorkspaceId: string | undefined,
): Promise<(WorkspaceRow & { role: "admin" | "member" }) | null> {
  await claimUnclaimedWorkspaces(email)

  // 1. Try cookie workspace
  if (cookieWorkspaceId) {
    const role = await getWorkspaceMemberRole(cookieWorkspaceId, email)
    if (role) {
      const ws = await getWorkspaceById(cookieWorkspaceId)
      if (ws) return { ...ws, role }
    }
  }

  // 2. Fall back to user's first workspace
  const userWs = await getUserWorkspaces(email)
  if (userWs.length > 0) {
    const ws = userWs[0]!
    return { ...ws, role: ws.role as "admin" | "member" }
  }

  return null
}


/** Get git info for a workspace directory. */
export function getWorkspaceGitInfo(workspacePath: string): {
  branch: string | null
  remote: string | null
  remoteUrl: string | null
  status: string[]
} {
  const result = { branch: null as string | null, remote: null as string | null, remoteUrl: null as string | null, status: [] as string[] }

  try {
    result.branch = execFileSync("git", ["branch", "--show-current"], { cwd: workspacePath, encoding: "utf-8" }).trim() || null
  } catch { /* not a git repo */ }

  try {
    const remote = execFileSync("git", ["remote", "get-url", "origin"], { cwd: workspacePath, encoding: "utf-8" }).trim()
    result.remote = remote
    const match = remote.match(/github\.com[:/](.+?)(?:\.git)?$/)
    if (match) {
      result.remoteUrl = `https://github.com/${match[1]}`
    }
  } catch { /* no remote */ }

  try {
    const status = execFileSync("git", ["status", "--porcelain"], { cwd: workspacePath, encoding: "utf-8" }).trim()
    if (status) {
      result.status = status.split("\n").slice(0, 20)
    }
  } catch { /* not a git repo */ }

  return result
}
