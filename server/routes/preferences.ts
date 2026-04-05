import { Hono, type Context } from "hono"
import { getCookie } from "hono/cookie"
import { execute, query, withTransaction } from "../db/pool.js"
import { getSession } from "../lib/auth.js"
import { SESSION_COOKIE } from "./auth.js"
import { SetPreferenceBody } from "../lib/schemas.js"
import type { ZodError } from "zod/v4"

/** Extract first user-facing message from a Zod validation error */
function zodErrorMessage(err: ZodError): string {
  return err.issues[0]?.message ?? "Invalid request body"
}

export const preferencesRoutes = new Hono()

async function getUserEmail(c: Context): Promise<string | null> {
  const token = getCookie(c, SESSION_COOKIE)
  if (!token) return null
  const session = await getSession(token)
  return session?.user.email ?? null
}

// GET /preferences — returns all preferences as { [key]: value }
preferencesRoutes.get("/", async (c) => {
  const email = await getUserEmail(c)
  if (!email) return c.json({ error: "Unauthorized" }, 401)

  const rows = await query<{ key: string; value: string }>(
    `SELECT key, value FROM user_preferences WHERE user_email = $1`,
    [email],
  )

  const prefs: Record<string, unknown> = {}
  for (const row of rows) {
    try {
      prefs[row.key] = JSON.parse(row.value)
    } catch {
      prefs[row.key] = row.value
    }
  }
  return c.json(prefs)
})

// PUT /preferences — body: { key: string, value: any }
preferencesRoutes.put("/", async (c) => {
  const email = await getUserEmail(c)
  if (!email) return c.json({ error: "Unauthorized" }, 401)

  let body: SetPreferenceBody
  try {
    body = SetPreferenceBody.parse(await c.req.json())
  } catch (err) {
    return c.json({ error: zodErrorMessage(err as ZodError) }, 400)
  }
  const { key, value } = body

  await execute(
    `INSERT INTO user_preferences (user_email, key, value, updated_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_email, key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    [email, key, JSON.stringify(value), new Date().toISOString()],
  )

  return c.json({ ok: true })
})

// PUT /preferences/batch — body: { prefs: { [key]: value } }
preferencesRoutes.put("/batch", async (c) => {
  const email = await getUserEmail(c)
  if (!email) return c.json({ error: "Unauthorized" }, 401)

  const { prefs } = await c.req.json()
  if (!prefs || typeof prefs !== "object") return c.json({ error: "Missing prefs" }, 400)

  const now = new Date().toISOString()
  await withTransaction(async (client) => {
    for (const [key, value] of Object.entries(prefs)) {
      await client.query(
        `INSERT INTO user_preferences (user_email, key, value, updated_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_email, key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
        [email, key, JSON.stringify(value), now],
      )
    }
  })

  return c.json({ ok: true })
})
