import { getNotionToken } from "./credentials.js"
import { getDb } from "../db/schema.js"

const NOTION_BASE = "https://api.notion.com/v1"
const NOTION_VERSION = "2022-06-28"
const TASKS_DB = "fd81d546-0ca5-4452-8171-15bce4957403"

async function notionRequest(path: string, options?: RequestInit) {
  const token = getNotionToken()
  const res = await fetch(`${NOTION_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Notion API ${res.status}: ${text}`)
  }
  return res.json()
}

function extractTitle(properties: any): string {
  const titleProp =
    properties.Name || properties.title || properties.Title
  if (!titleProp?.title?.length) return "Untitled"
  return titleProp.title.map((t: any) => t.plain_text).join("")
}

function extractSelect(properties: any, key: string): string {
  return properties[key]?.select?.name || properties[key]?.status?.name || ""
}

function extractMultiSelect(properties: any, key: string): string[] {
  return (properties[key]?.multi_select || []).map((s: any) => s.name)
}

function extractPerson(properties: any, key: string): string {
  const people = properties[key]?.people || []
  if (!people.length) return ""
  return people[0].name || people[0].person?.email || ""
}

function parseTask(page: any) {
  const props = page.properties || {}
  return {
    id: page.id,
    title: extractTitle(props),
    status: extractSelect(props, "Status"),
    tags: extractMultiSelect(props, "Tags"),
    priority: extractSelect(props, "Priority"),
    assignee: extractPerson(props, "Assignee"),
    createdAt: page.created_time,
    updatedAt: page.last_edited_time,
    url: page.url,
  }
}

export async function queryTasks(filters?: {
  status?: string
  tags?: string
  assignee?: string
  priority?: string
  cursor?: string
  pageSize?: number
}) {
  const filterConditions: any[] = []

  if (filters?.status) {
    const values = filters.status.split(",")
    if (values.length === 1) {
      filterConditions.push({
        property: "Status",
        status: { equals: values[0] },
      })
    } else {
      filterConditions.push({
        or: values.map((v) => ({
          property: "Status",
          status: { equals: v },
        })),
      })
    }
  }
  if (filters?.tags) {
    const values = filters.tags.split(",")
    for (const tag of values) {
      filterConditions.push({
        property: "Tags",
        multi_select: { contains: tag },
      })
    }
  }
  if (filters?.assignee) {
    filterConditions.push({
      property: "Assignee",
      people: { contains: filters.assignee },
    })
  }
  if (filters?.priority) {
    const values = filters.priority.split(",")
    if (values.length === 1) {
      filterConditions.push({
        property: "Priority",
        select: { equals: values[0] },
      })
    } else {
      filterConditions.push({
        or: values.map((v) => ({
          property: "Priority",
          select: { equals: v },
        })),
      })
    }
  }

  const body: any = {
    sorts: [{ property: "Status", direction: "ascending" }],
    page_size: filters?.pageSize || 50,
  }
  if (filters?.cursor) body.start_cursor = filters.cursor

  if (filterConditions.length === 1) {
    body.filter = filterConditions[0]
  } else if (filterConditions.length > 1) {
    body.filter = { and: filterConditions }
  }

  const result = await notionRequest(`/databases/${TASKS_DB}/query`, {
    method: "POST",
    body: JSON.stringify(body),
  })

  return {
    tasks: (result.results || []).map(parseTask),
    nextCursor: result.has_more ? result.next_cursor : null,
  }
}

async function fetchBlockChildren(blockId: string, depth = 0): Promise<any[]> {
  if (depth > 2) return [] // Limit recursion depth
  const blocks = await notionRequest(`/blocks/${blockId}/children`)
  const results = blocks.results || []

  // Recursively fetch children for blocks that have them
  for (const block of results) {
    if (block.has_children) {
      block.children = await fetchBlockChildren(block.id, depth + 1)
    }
  }

  return results
}

export async function getTaskDetail(taskId: string) {
  const [page, children] = await Promise.all([
    notionRequest(`/pages/${taskId}`),
    fetchBlockChildren(taskId),
  ])

  const task = parseTask(page)

  // Extract text from blocks for body (plain text fallback)
  const body = children
    .map((block: any) => {
      const type = block.type
      const content = block[type]
      if (!content?.rich_text) return ""
      return content.rich_text.map((t: any) => t.plain_text).join("")
    })
    .filter(Boolean)
    .join("\n")

  return {
    ...task,
    body,
    properties: page.properties,
    children,
  }
}

export async function updateTaskProperties(
  taskId: string,
  properties: Record<string, unknown>,
) {
  await notionRequest(`/pages/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify({ properties }),
  })
  return { ok: true }
}

export async function createTask(
  title: string,
  body?: string,
  properties?: Record<string, unknown>,
) {
  const page: any = {
    parent: { database_id: TASKS_DB },
    properties: {
      Name: { title: [{ text: { content: title } }] },
      ...properties,
    },
  }

  if (body) {
    page.children = [
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [{ type: "text", text: { content: body } }],
        },
      },
    ]
  }

  const result = await notionRequest("/pages", {
    method: "POST",
    body: JSON.stringify(page),
  })

  return parseTask(result)
}

// Fetch database schema and cache property options in SQLite
export async function syncPropertyOptions() {
  const schema = await notionRequest(`/databases/${TASKS_DB}`)
  const db = getDb()
  const now = new Date().toISOString()

  const insert = db.prepare(
    `INSERT OR REPLACE INTO notion_options (property, value, color, updated_at)
     VALUES (?, ?, ?, ?)`,
  )

  const syncProperty = db.transaction(
    (property: string, options: { name: string; color?: string }[]) => {
      db.prepare(`DELETE FROM notion_options WHERE property = ?`).run(property)
      for (const opt of options) {
        insert.run(property, opt.name, opt.color || null, now)
      }
    },
  )

  const props = schema.properties || {}
  for (const [name, prop] of Object.entries(props) as [string, any][]) {
    if (prop.type === "status" && prop.status?.options) {
      syncProperty(name, prop.status.options)
    } else if (prop.type === "select" && prop.select?.options) {
      syncProperty(name, prop.select.options)
    } else if (prop.type === "multi_select" && prop.multi_select?.options) {
      syncProperty(name, prop.multi_select.options)
    }
  }

  console.log("Synced Notion property options")
}

export function getPropertyOptions(property: string) {
  const db = getDb()
  return db
    .prepare(`SELECT value, color FROM notion_options WHERE property = ? ORDER BY rowid`)
    .all(property) as { value: string; color: string | null }[]
}
