/**
 * Notion Tasks built-in plugin — wraps server/lib/notion.ts task functions.
 *
 * Auth: workspace-scoped API key (NOTION_API_TOKEN).
 */

import * as notion from "../lib/notion.js"
import { handleNotionMutation, mountNotionOptionsRoute } from "./notion-shared.js"
import type { Plugin } from "../../src/types/plugin.js"

export const notionTasksPlugin: Plugin = {
  id: "notion-tasks",
  name: "Tasks",
  icon: "CheckSquare",
  emoji: "✅",
  components: { tab: "notion-tasks:tab" },
  auth: { integrationId: "notion", scope: "workspace" },

  fieldSchema: [
    { id: "title", label: "Title", type: "text", listRole: "title" },
    { id: "updatedAt", label: "Updated", type: "date", listRole: "timestamp" },
    {
      id: "status", label: "Status", type: "select",
      badge: { show: "always", variant: "outline" },
      filter: { filterable: true },
    },
    {
      id: "priority", label: "Priority", type: "select",
      badge: { show: "if-set", variant: "secondary" },
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
    const result = await notion.queryTasks({
      status: filters.status,
      tags: filters.tags,
      assignee: filters.assignee,
      priority: filters.priority,
      cursor: cursor || undefined,
    })
    return {
      items: result.tasks as any[],
      nextCursor: result.nextCursor ?? undefined,
    }
  },

  async getItem(id) {
    return await notion.getTaskDetail(id) as any
  },

  async mutate(id, action, payload) {
    if (action === "update-priority") {
      const { priority } = payload as { priority: string }
      await notion.updateTaskProperties(id, { Priority: { select: { name: priority } } } as any)
      return
    }
    const handled = await handleNotionMutation(id, action, payload)
    if (!handled) throw new Error(`Unknown task action: ${action}`)
  },

  filterOptions: {
    status: async () => notion.getPropertyOptions("Status").map((o) => o.value),
    priority: async () => notion.getPropertyOptions("Priority").map((o) => o.value),
    tags: async () => notion.getPropertyOptions("Tags").map((o) => o.value),
    assignee: async () => {
      const result = await notion.queryTasks({})
      return [...new Set(result.tasks.map((t) => t.assignee).filter(Boolean))].sort()
    },
  },

  routes(app, { getContext }) {
    mountNotionOptionsRoute(app)

    // Assignees
    app.get("/assignees", async (c) => {
      const assignees = await notionTasksPlugin.filterOptions!.assignee!()
      return c.json({ assignees })
    })

    // Create task
    app.post("/", async (c) => {
      const { title, body, properties } = await c.req.json()
      const task = await notion.createTask(title, body, properties)
      return c.json(task)
    })

  },
}
