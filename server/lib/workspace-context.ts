import { HTTPException } from "hono/http-exception"
import type { Context } from "hono"

export interface WorkspaceContext {
  id: string
  name: string
  path: string
  role: "admin" | "member"
}

export type AppBindings = {
  Variables: {
    user: { name: string; email: string; picture?: string }
    userEmail: string
    userName: string
    sessionToken: string
    workspace: WorkspaceContext
  }
}

/** Throw 403 if the current user is not an admin of the active workspace. */
export function requireAdmin(c: Context): void {
  const ws = c.get("workspace") as WorkspaceContext | undefined
  if (!ws || ws.role !== "admin") {
    throw new HTTPException(403, { message: "Admin access required" })
  }
}
