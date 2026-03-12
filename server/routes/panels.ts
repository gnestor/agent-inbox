import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import { getPanelSchemas, executeMutation } from "../lib/panel-registry.js"

export const panelRoutes = new Hono()

/** GET /api/panels — return all registered tag → widget schema mappings */
panelRoutes.get("/", (c) => {
  return c.json(getPanelSchemas())
})

/** POST /api/panels/mutate/:action — execute a workflow panel mutation */
panelRoutes.post("/mutate/:action", async (c) => {
  const { action } = c.req.param()
  const { payload } = await c.req.json().catch(() => ({ payload: undefined }))

  // Build context from server environment
  const ctx = {
    workspacePath: process.env.WORKSPACE_PATH ?? "",
    env: process.env as Record<string, string | undefined>,
  }

  try {
    await executeMutation(action, payload, ctx)
    return c.json({ ok: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    throw new HTTPException(400, { message })
  }
})
