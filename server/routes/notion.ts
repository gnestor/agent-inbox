import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import * as notion from "../lib/notion.js"
import type { TaskPropertyUpdate, CalendarPropertyUpdate } from "../../src/types/notion-mutations.js"

const TASK_PROPERTY_KEYS: Set<keyof TaskPropertyUpdate> = new Set(["Status", "Priority", "Tags", "Assignee"])
const CALENDAR_PROPERTY_KEYS: Set<keyof CalendarPropertyUpdate> = new Set(["Status", "Tags", "Assignee", "Date"])

/** Validate that a mutation payload only contains known property keys. */
function validatePropertyKeys<T>(body: unknown, validKeys: Set<string>): T {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HTTPException(400, { message: "Request body must be a JSON object" })
  }
  const keys = Object.keys(body)
  if (keys.length === 0) {
    throw new HTTPException(400, { message: "At least one property is required" })
  }
  for (const key of keys) {
    if (!validKeys.has(key)) {
      throw new HTTPException(400, { message: `Unknown property: "${key}". Valid: ${[...validKeys].join(", ")}` })
    }
  }
  return body as T
}

export const notionRoutes = new Hono()

notionRoutes.get("/calendar", async (c) => {
  const status = c.req.query("status")
  const tags = c.req.query("tags")
  const assignee = c.req.query("assignee")
  const cursor = c.req.query("cursor")
  const result = await notion.queryCalendarItems({ status, tags, assignee, cursor: cursor || undefined })
  return c.json(result)
})

notionRoutes.get("/calendar-assignees", async (c) => {
  const result = await notion.queryCalendarItems({})
  const assignees = [...new Set(result.items.map((i) => i.assignee).filter(Boolean))].sort()
  return c.json({ assignees })
})

notionRoutes.get("/calendar/:id", async (c) => {
  const id = c.req.param("id")
  const item = await notion.getCalendarItemDetail(id)
  return c.json(item)
})

notionRoutes.patch("/calendar/:id", async (c) => {
  const properties = validatePropertyKeys<CalendarPropertyUpdate>(await c.req.json(), CALENDAR_PROPERTY_KEYS)
  const id = c.req.param("id")
  const result = await notion.updateTaskProperties(id, properties)
  return c.json(result)
})

notionRoutes.get("/tasks", async (c) => {
  const status = c.req.query("status")
  const tags = c.req.query("tags")
  const assignee = c.req.query("assignee")
  const priority = c.req.query("priority")
  const cursor = c.req.query("cursor")
  const result = await notion.queryTasks({ status, tags, assignee, priority, cursor: cursor || undefined })
  return c.json(result)
})

notionRoutes.get("/tasks/:id", async (c) => {
  const id = c.req.param("id")
  const task = await notion.getTaskDetail(id)
  return c.json(task)
})

notionRoutes.patch("/tasks/:id", async (c) => {
  const properties = validatePropertyKeys<TaskPropertyUpdate>(await c.req.json(), TASK_PROPERTY_KEYS)
  const id = c.req.param("id")
  const result = await notion.updateTaskProperties(id, properties)
  return c.json(result)
})

notionRoutes.get("/assignees", async (c) => {
  const tasks = await notion.queryTasks({})
  const assignees = [...new Set(tasks.tasks.map((t) => t.assignee).filter(Boolean))].sort()
  return c.json({ assignees })
})

notionRoutes.get("/options/:property", async (c) => {
  const property = c.req.param("property")
  const options = notion.getPropertyOptions(property)
  return c.json({ options })
})

notionRoutes.post("/options/sync", async (c) => {
  await notion.syncPropertyOptions()
  return c.json({ ok: true })
})

notionRoutes.post("/tasks", async (c) => {
  const { title, body, properties } = await c.req.json()
  const task = await notion.createTask(title, body, properties)
  return c.json(task)
})
