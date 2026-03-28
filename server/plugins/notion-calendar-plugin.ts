/**
 * Notion Calendar built-in plugin — wraps server/lib/notion.ts calendar functions.
 *
 * Auth: workspace-scoped API key (NOTION_API_TOKEN).
 */

import * as notion from "../lib/notion.js"
import { handleNotionMutation, mountNotionOptionsRoute } from "./notion-shared.js"
import type { Plugin } from "../../src/types/plugin.js"

export const notionCalendarPlugin: Plugin = {
  id: "notion-calendar",
  name: "Calendar",
  icon: "Calendar",
  emoji: "📅",
  components: { tab: "notion-calendar:tab" },
  auth: { integrationId: "notion", scope: "workspace" },

  fieldSchema: [
    { id: "title", label: "Title", type: "text", listRole: "title" },
    { id: "date", label: "Date", type: "date", listRole: "timestamp" },
    {
      id: "status", label: "Status", type: "select",
      badge: { show: "always", variant: "outline" },
      filter: { filterable: true },
    },
    {
      id: "tags", label: "Tags", type: "multiselect",
      badge: { show: "if-set", variant: "secondary" },
      filter: { filterable: true },
    },
    {
      id: "assignee", label: "Assignee", type: "text",
      badge: { show: "if-set", variant: "secondary" },
      filter: { filterable: true },
    },
    { id: "body", label: "Body", type: "text", listRole: "hidden" },
  ],

  async query(filters, cursor) {
    const result = await notion.queryCalendarItems({
      status: filters.status,
      tags: filters.tags,
      assignee: filters.assignee,
      cursor: cursor || undefined,
    })
    return {
      items: result.items as any[],
      nextCursor: result.nextCursor ?? undefined,
    }
  },

  async getItem(id) {
    return await notion.getCalendarItemDetail(id) as any
  },

  async mutate(id, action, payload) {
    const handled = await handleNotionMutation(id, action, payload)
    if (!handled) throw new Error(`Unknown calendar action: ${action}`)
  },

  filterOptions: {
    status: async () => (await notion.getPropertyOptions("calendar:Status")).map((o) => o.value),
    tags: async () => (await notion.getPropertyOptions("calendar:Tags")).map((o) => o.value),
    assignee: async () => {
      const result = await notion.queryCalendarItems({})
      return [...new Set(result.items.map((i) => i.assignee).filter(Boolean))].sort()
    },
  },

  routes(app, { getContext }) {
    mountNotionOptionsRoute(app)

    // Assignees
    app.get("/calendar-assignees", async (c) => {
      const assignees = await notionCalendarPlugin.filterOptions!.assignee!()
      return c.json({ assignees })
    })

    // Get calendar item detail
    app.get("/calendar/:id", async (c) => {
      const id = c.req.param("id")
      const item = await notion.getCalendarItemDetail(id)
      return c.json(item)
    })

  },
}
