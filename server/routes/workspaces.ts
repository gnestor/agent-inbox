import { Hono } from "hono"
import { setCookie } from "hono/cookie"
import { query as dbQuery, queryOne } from "../db/pool.js"
import {
  getUserWorkspaces,
  getWorkspaceById,
  getWorkspaceMembers,
  addWorkspaceMember,
  removeWorkspaceMember,
  updateWorkspaceMemberRole,
  updateWorkspaceName,
  getWorkspaceGitInfo,
  isLastAdmin,
} from "../lib/workspace-scanner.js"
import { requireAdmin } from "../lib/workspace-context.js"
import type { AppBindings } from "../lib/workspace-context.js"
import {
  AddWorkspaceMemberBody,
  RenameWorkspaceBody,
  SetActiveWorkspaceBody,
  UpdateMemberRoleBody,
} from "../lib/schemas.js"
import type { ZodError } from "zod/v4"

/** Extract first user-facing message from a Zod validation error */
function zodErrorMessage(err: ZodError): string {
  return err.issues[0]?.message ?? "Invalid request body"
}

export const WORKSPACE_COOKIE = "inbox_workspace"

export const workspaceRoutes = new Hono<AppBindings>()

/** List workspaces the current user is a member of + active workspace ID. */
workspaceRoutes.get("/", async (c) => {
  const email = c.get("userEmail")
  const workspaces = await getUserWorkspaces(email)
  const activeWorkspaceId = c.get("workspace")?.id || null
  return c.json({ workspaces, activeWorkspaceId })
})

/** Set active workspace (sets cookie). */
workspaceRoutes.put("/active", async (c) => {
  let body: SetActiveWorkspaceBody
  try {
    body = SetActiveWorkspaceBody.parse(await c.req.json())
  } catch (err) {
    return c.json({ error: zodErrorMessage(err as ZodError) }, 400)
  }
  const { workspaceId } = body
  const ws = await getWorkspaceById(workspaceId)
  if (!ws) return c.json({ error: "Workspace not found" }, 404)

  setCookie(c, WORKSPACE_COOKIE, workspaceId, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    maxAge: 60 * 60 * 24 * 365,
  })

  return c.json({ id: ws.id, name: ws.name })
})

/** Get workspace details + members (admin only). */
workspaceRoutes.get("/:id", async (c) => {
  requireAdmin(c)
  const id = c.req.param("id")
  const ws = await getWorkspaceById(id)
  if (!ws) return c.json({ error: "Workspace not found" }, 404)
  const members = await getWorkspaceMembers(id)
  return c.json({ workspace: ws, members })
})

/** Update workspace name (admin only). */
workspaceRoutes.put("/:id", async (c) => {
  requireAdmin(c)
  const id = c.req.param("id")
  let body: RenameWorkspaceBody
  try {
    body = RenameWorkspaceBody.parse(await c.req.json())
  } catch (err) {
    return c.json({ error: zodErrorMessage(err as ZodError) }, 400)
  }
  const updated = await updateWorkspaceName(id, body.name.trim())
  if (!updated) return c.json({ error: "Workspace not found" }, 404)
  return c.json({ ok: true })
})

/** Get git info for a workspace (admin only). */
workspaceRoutes.get("/:id/git", async (c) => {
  requireAdmin(c)
  const id = c.req.param("id")
  const ws = await getWorkspaceById(id)
  if (!ws) return c.json({ error: "Workspace not found" }, 404)
  const gitInfo = getWorkspaceGitInfo(ws.path)
  return c.json(gitInfo)
})

/** Add a member to a workspace (admin only). */
workspaceRoutes.post("/:id/members", async (c) => {
  requireAdmin(c)
  const id = c.req.param("id")
  const ws = await getWorkspaceById(id)
  if (!ws) return c.json({ error: "Workspace not found" }, 404)

  let body: AddWorkspaceMemberBody
  try {
    body = AddWorkspaceMemberBody.parse(await c.req.json())
  } catch (err) {
    return c.json({ error: zodErrorMessage(err as ZodError) }, 400)
  }
  const { email, role } = body

  const user = await queryOne<{ email: string }>("SELECT email FROM users WHERE email = $1", [email])
  if (!user) return c.json({ error: "User not found" }, 404)

  await addWorkspaceMember(id, email, role || "member")
  return c.json({ ok: true })
})

/** Remove a member from a workspace (admin only). */
workspaceRoutes.delete("/:id/members/:email", async (c) => {
  requireAdmin(c)
  const id = c.req.param("id")
  const email = c.req.param("email")

  if (await isLastAdmin(id, email)) {
    return c.json({ error: "Cannot remove the last admin" }, 400)
  }

  const removed = await removeWorkspaceMember(id, email)
  if (!removed) return c.json({ error: "Member not found" }, 404)
  return c.json({ ok: true })
})

/** Update a member's role (admin only). */
workspaceRoutes.patch("/:id/members/:email", async (c) => {
  requireAdmin(c)
  const id = c.req.param("id")
  const email = c.req.param("email")
  let body: UpdateMemberRoleBody
  try {
    body = UpdateMemberRoleBody.parse(await c.req.json())
  } catch (err) {
    return c.json({ error: zodErrorMessage(err as ZodError) }, 400)
  }
  const { role } = body

  if (role === "member" && await isLastAdmin(id, email)) {
    return c.json({ error: "Cannot demote the last admin" }, 400)
  }

  const updated = await updateWorkspaceMemberRole(id, email, role)
  if (!updated) return c.json({ error: "Member not found" }, 404)
  return c.json({ ok: true })
})

/** List all users not yet in this workspace (for member combobox). */
workspaceRoutes.get("/:id/available-users", async (c) => {
  requireAdmin(c)
  const id = c.req.param("id")
  const users = await dbQuery(
    `SELECT u.email, u.name, u.picture FROM users u
     WHERE u.email NOT IN (SELECT user_email FROM workspace_members WHERE workspace_id = $1)
     ORDER BY u.name`,
    [id],
  )
  return c.json({ users })
})
