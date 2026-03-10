import { Hono } from "hono"
import * as notion from "../lib/notion.js"

export const notionRoutes = new Hono()

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
  const properties = await c.req.json()
  const id = c.req.param("id")
  const result = await notion.updateTaskProperties(id, properties)
  return c.json(result)
})

notionRoutes.get("/assignees", async (c) => {
  const tasks = await notion.queryTasks({})
  const assignees = [...new Set(tasks.tasks.map((t: any) => t.assignee).filter(Boolean))].sort()
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
