/**
 * Shared handlers for Notion-backed plugins (tasks + calendar).
 */

import type { Hono } from "hono"
import * as notion from "../lib/notion.js"

/** Mount a GET /options/:property route that returns cached Notion property options. */
export function mountNotionOptionsRoute(app: Hono): void {
  app.get("/options/:property", (c) => {
    const property = c.req.param("property")
    const options = notion.getPropertyOptions(property)
    return c.json({ options })
  })
}

/** Handle common Notion property mutation actions. Returns true if handled. */
export async function handleNotionMutation(id: string, action: string, payload: unknown): Promise<boolean> {
  switch (action) {
    case "update-status": {
      const { status } = payload as { status: string }
      await notion.updateTaskProperties(id, { Status: { status: { name: status } } } as any)
      return true
    }
    case "update-tags": {
      const { tags } = payload as { tags: string[] }
      await notion.updateTaskProperties(id, { Tags: { multi_select: tags.map((t) => ({ name: t })) } } as any)
      return true
    }
    case "update-assignee": {
      const { assigneeId } = payload as { assigneeId: string }
      await notion.updateTaskProperties(id, { Assignee: { people: [{ id: assigneeId }] } } as any)
      return true
    }
    case "update-date": {
      const { date } = payload as { date: string }
      await notion.updateTaskProperties(id, { Date: { date: { start: date } } } as any)
      return true
    }
    case "update-properties": {
      await notion.updateTaskProperties(id, payload as any)
      return true
    }
    default:
      return false
  }
}
