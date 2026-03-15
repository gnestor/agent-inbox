# Phase 5: Source Plugins — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settle on a unified plugin spec by refactoring the existing Gmail and Notion sources to implement it, then build new plugins (Slack first). All sources appear identically in the sidebar -- no "built-in vs plugin" distinction.

**Architecture:** The existing `SourcePlugin` interface in `src/types/plugin.ts` already covers `query()`, `mutate()`, `fieldSchema`, `detailSchema`, and `querySubItems()`. The PLAN.md proposed a different interface (`list`, `detail`, `subscribe`, `defaultView`), but the codebase already has a working plugin system. This phase extends the existing spec with `detail()`, `subscribe()`, and `defaultView`, then refactors Gmail and Notion from bespoke routes into `SourcePlugin` implementations that run through the same `pluginRoutes` and `PluginView` UI. Dedicated tabs (Emails, Tasks, Calendar) are preserved as route aliases into the plugin system.

**Tech Stack:** Hono routes, Slack Web API (`fetch`-based), React 19, TanStack Query, existing `SourcePlugin` interface, `plugin-loader.ts`, `PluginView`/`PluginList`/`PluginDetail` components.

**Prerequisite:** Phase 4's TabGrid/Tab/Panel component system must be complete before starting Chunk 8. Phase 5 does NOT modify PanelStack internals or routing directly. Instead, source plugins register as tabs using the declarative Tab/Panel API from Phase 4:

```tsx
// Source plugins register as tabs:
<Tab id={plugin.id}>
  <Panel id="list"><PluginList sourceId={plugin.id} /></Panel>
  <Panel id="detail"><PluginDetail sourceId={plugin.id} /></Panel>
</Tab>
```

This means built-in sources (Gmail, Notion, Slack) are rendered the same way as any other source -- they declare Tab/Panel components and the TabGrid handles navigation, back/forward, and panel layout.

---

## File Structure

```
server/
  lib/
    plugin-loader.ts              -- MODIFY: add built-in plugin registration, detail() support
    sources/
      gmail-source.ts             -- CREATE: SourcePlugin implementation wrapping server/lib/gmail.ts
      notion-tasks-source.ts      -- CREATE: SourcePlugin implementation wrapping server/lib/notion.ts (tasks)
      notion-calendar-source.ts   -- CREATE: SourcePlugin implementation wrapping server/lib/notion.ts (calendar)
      slack-source.ts             -- CREATE: SourcePlugin implementation using Slack Web API
    __tests__/
      gmail-source.test.ts        -- CREATE: tests for Gmail source adapter
      notion-tasks-source.test.ts -- CREATE: tests for Notion tasks source adapter
      slack-source.test.ts        -- CREATE: tests for Slack source plugin
      plugin-loader.test.ts       -- MODIFY: add tests for built-in plugin registration + detail()
  routes/
    plugins.ts                    -- MODIFY: add GET /:sourceId/items/:itemId (detail endpoint)
    gmail.ts                      -- KEEP: preserve all existing endpoints for backward compat
    notion.ts                     -- KEEP: preserve all existing endpoints for backward compat
src/
  types/
    plugin.ts                     -- MODIFY: add detail(), subscribe?(), defaultView to SourcePlugin
  api/
    client.ts                     -- MODIFY: add getPluginItemDetail(), keep existing Gmail/Notion fns
  hooks/
    use-plugins.ts                -- MODIFY: add usePluginItemDetail() hook
  components/
    plugin/
      PluginDetail.tsx            -- MODIFY: use detail() endpoint when available
      PluginConversationView.tsx  -- CREATE: conversation-style detail view for email/Slack
    layout/
      AppSidebar.tsx              -- MODIFY: merge Sources + Plugins into one section
      App.tsx                     -- MODIFY: update routing (Phase 4 Tab/Panel API, NOT PanelStack)
```

---

## Chunk 1: Extend the SourcePlugin Interface

Design and test the interface extensions before writing any source adapters. The existing `SourcePlugin` has `query()`, `mutate()`, `fieldSchema`, `detailSchema`, `querySubItems()`. We add `detail()`, `subscribe()`, and `defaultView`.

### Task 1: Extend SourcePlugin type

**Files:**
- Modify: `src/types/plugin.ts`

- [ ] **Step 1: Add detail(), subscribe(), and defaultView to the interface**

In `src/types/plugin.ts`, add these members to the `SourcePlugin` interface:

```typescript
  /**
   * Fetch a single item's full detail. If omitted, the detail view uses
   * the item from the query() results (works for simple sources where list
   * items contain all needed data).
   */
  detail?(id: string): Promise<PluginItem>

  /**
   * Register a webhook URL to receive push notifications from the source.
   * The inbox server calls this once when the plugin is loaded.
   * The webhook payload is source-specific; the server invalidates the
   * plugin's query cache when a webhook fires.
   */
  subscribe?(webhookUrl: string): Promise<void>

  /**
   * Preferred detail view layout. Controls which PluginDetail renderer is used.
   * - "conversation": threaded message list (email, Slack)
   * - "table": tabular data
   * - "document": rich body with metadata header
   * - "card": compact metadata card
   * Defaults to "document" when omitted.
   */
  defaultView?: "conversation" | "table" | "document" | "card"
```

Also add `DetailResult` type alias for clarity:

```typescript
export type DetailResult = PluginItem
```

- [ ] **Step 2: Run type check**

Run: `cd packages/inbox && npx tsc --noEmit`
Expected: PASS (all new members are optional)

- [ ] **Step 3: Commit**

```bash
git add src/types/plugin.ts
git commit -m "feat: extend SourcePlugin interface with detail(), subscribe(), defaultView"
```

### Task 2: Add detail endpoint to plugin routes

**Files:**
- Modify: `server/routes/plugins.ts`

- [ ] **Step 1: Add GET /:sourceId/items/:itemId route**

Add between the existing `GET /:sourceId/items` and `GET /:sourceId/items/:itemId/subitems` routes:

```typescript
/** GET /api/plugins/:sourceId/items/:itemId -- get single item detail */
pluginRoutes.get("/:sourceId/items/:itemId", async (c) => {
  const { sourceId, itemId } = c.req.param()
  const plugin = getPlugin(sourceId)
  if (!plugin) throw new HTTPException(404, { message: `Plugin "${sourceId}" not found` })

  if (plugin.detail) {
    const item = await plugin.detail(itemId)
    return c.json(item)
  }

  // Fallback: no detail() method -- return 404 (client should use list data)
  throw new HTTPException(404, { message: `Plugin "${sourceId}" does not support detail view` })
})
```

**Important:** The `/:sourceId/items/:itemId/subitems` route MUST be registered BEFORE `/:sourceId/items/:itemId`, or Hono will greedily match the `subitems` segment as part of `:itemId`. This is a route registration order issue, not a pattern specificity issue -- Hono matches routes in registration order for parameterized segments.

- [ ] **Step 2: Verify route registration order**

After adding the detail route, open `server/routes/plugins.ts` and confirm the routes are registered in this exact order:

1. `GET /:sourceId/items/:itemId/subitems` (most specific -- registered FIRST)
2. `GET /:sourceId/items/:itemId` (detail -- registered SECOND)
3. `GET /:sourceId/items` (list)

Write a test that hits both `/:sourceId/items/:itemId/subitems` and `/:sourceId/items/:itemId` to confirm Hono dispatches to the correct handler for each. If the subitems route is currently registered after the detail route, move it above.

- [ ] **Step 3: Run tests**

Run: `cd packages/inbox && npm run test:ci`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add server/routes/plugins.ts
git commit -m "feat: add GET /plugins/:sourceId/items/:itemId detail endpoint"
```

### Task 3: Add API client function and hook for detail

**Files:**
- Modify: `src/api/client.ts`
- Modify: `src/hooks/use-plugins.ts`

- [ ] **Step 1: Add getPluginItemDetail to client.ts**

Add after the `queryPluginItems` function:

```typescript
export async function getPluginItemDetail(sourceId: string, itemId: string) {
  return request<import("@/types/plugin").PluginItem>(
    `/plugins/${sourceId}/items/${itemId}`,
  )
}
```

- [ ] **Step 2: Add usePluginItemDetail hook**

In `src/hooks/use-plugins.ts`, add:

```typescript
export function usePluginItemDetail(
  sourceId: string,
  itemId: string,
  enabled = true
) {
  return useQuery({
    queryKey: ["plugin-item-detail", sourceId, itemId],
    queryFn: () => getPluginItemDetail(sourceId, itemId),
    enabled: enabled && !!sourceId && !!itemId,
  })
}
```

Add `getPluginItemDetail` to the import from `@/api/client`.

- [ ] **Step 3: Run tests**

Run: `cd packages/inbox && npm run test:ci`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/api/client.ts src/hooks/use-plugins.ts
git commit -m "feat: add getPluginItemDetail API client and usePluginItemDetail hook"
```

---

## Chunk 2: Gmail Source Plugin

Wrap the existing `server/lib/gmail.ts` functions as a `SourcePlugin`. The existing `gmailRoutes` stay mounted for backward compatibility (the frontend's email components still call them directly). The new source plugin enables Gmail to appear in the unified sources list alongside workspace plugins.

### Task 4: Gmail source adapter -- test first

**Files:**
- Create: `server/lib/__tests__/gmail-source.test.ts`

- [ ] **Step 1: Write tests for the Gmail source adapter**

```typescript
// server/lib/__tests__/gmail-source.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock the gmail module
vi.mock("../gmail.js", () => ({
  searchThreads: vi.fn(),
  getThread: vi.fn(),
  trashThread: vi.fn(),
  modifyThreadLabels: vi.fn(),
}))

// Mock cache
vi.mock("../cache.js", () => ({
  get: vi.fn(() => null),
  set: vi.fn(),
  invalidate: vi.fn(),
}))

const gmail = await import("../gmail.js")
const { default: gmailSource } = await import("../sources/gmail-source.js")

describe("gmail-source", () => {
  beforeEach(() => vi.clearAllMocks())

  it("has correct plugin metadata", () => {
    expect(gmailSource.id).toBe("gmail")
    expect(gmailSource.name).toBe("Emails")
    expect(gmailSource.icon).toBe("Mail")
    expect(gmailSource.defaultView).toBe("conversation")
  })

  it("query() calls searchThreads and maps results to PluginItems", async () => {
    const mockThreads = [
      {
        id: "thread-1",
        subject: "Re: Q1 Report",
        snippet: "Here are the numbers...",
        from: "alice@example.com",
        date: "2026-03-10T12:00:00Z",
        messageCount: 3,
        isUnread: true,
        labelIds: ["INBOX", "UNREAD"],
      },
    ]
    vi.mocked(gmail.searchThreads).mockResolvedValue({
      threads: mockThreads,
      nextPageToken: "token123",
      historyId: "h1",
    })

    const result = await gmailSource.query({ q: "in:inbox" })
    expect(result.items).toHaveLength(1)
    expect(result.items[0].id).toBe("thread-1")
    expect(result.items[0].subject).toBe("Re: Q1 Report")
    expect(result.items[0].from).toBe("alice@example.com")
    expect(result.items[0].isUnread).toBe(true)
    expect(result.nextCursor).toBe("token123")
  })

  it("query() passes query filter to searchThreads", async () => {
    vi.mocked(gmail.searchThreads).mockResolvedValue({
      threads: [],
      nextPageToken: null,
      historyId: "h1",
    })

    await gmailSource.query({ q: "from:bob" }, "page2")
    expect(gmail.searchThreads).toHaveBeenCalledWith("from:bob", 20, "page2")
  })

  it("query() defaults to 'in:inbox' when no q filter", async () => {
    vi.mocked(gmail.searchThreads).mockResolvedValue({
      threads: [],
      nextPageToken: null,
      historyId: "h1",
    })

    await gmailSource.query({})
    expect(gmail.searchThreads).toHaveBeenCalledWith("in:inbox", 20, undefined)
  })

  it("detail() calls getThread and returns full thread", async () => {
    const mockThread = {
      id: "thread-1",
      subject: "Re: Q1 Report",
      messages: [{ id: "msg-1", body: "Hello", from: "alice@example.com" }],
      snippet: "Hello",
      from: "alice@example.com",
      date: "2026-03-10",
      messageCount: 1,
      isUnread: false,
      labelIds: ["INBOX"],
    }
    vi.mocked(gmail.getThread).mockResolvedValue(mockThread)

    const result = await gmailSource.detail!("thread-1")
    expect(result.id).toBe("thread-1")
    expect(result.messages).toBeDefined()
  })

  it("mutate() supports trash action", async () => {
    vi.mocked(gmail.trashThread).mockResolvedValue(undefined as any)
    await gmailSource.mutate("thread-1", "trash")
    expect(gmail.trashThread).toHaveBeenCalledWith("thread-1")
  })

  it("mutate() supports archive action (remove INBOX label)", async () => {
    vi.mocked(gmail.modifyThreadLabels).mockResolvedValue(undefined as any)
    await gmailSource.mutate("thread-1", "archive")
    expect(gmail.modifyThreadLabels).toHaveBeenCalledWith(
      "thread-1",
      [],
      ["INBOX"]
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/inbox && npx vitest run server/lib/__tests__/gmail-source.test.ts`
Expected: FAIL -- cannot find `../sources/gmail-source.js`

- [ ] **Step 3: Commit**

```bash
git add server/lib/__tests__/gmail-source.test.ts
git commit -m "test: add gmail-source adapter tests"
```

### Task 5: Gmail source adapter -- implementation

**Files:**
- Create: `server/lib/sources/gmail-source.ts`

- [ ] **Step 1: Implement the Gmail source plugin**

```typescript
// server/lib/sources/gmail-source.ts
import * as gmail from "../gmail.js"
import { invalidate } from "../cache.js"
// NOTE: This import crosses the server/src boundary. This matches the existing
// pattern in plugin-loader.ts. Future cleanup: create a shared types/ directory
// at the package root so server/ and src/ both import from the same place.
import type { SourcePlugin, PluginItem, QueryResult } from "../../../src/types/plugin.js"

const gmailSource: SourcePlugin = {
  id: "gmail",
  name: "Emails",
  icon: "Mail",
  defaultView: "conversation" as const,

  fieldSchema: [
    {
      id: "subject",
      label: "Subject",
      type: "text",
    },
    {
      id: "from",
      label: "From",
      type: "text",
    },
    {
      id: "date",
      label: "Date",
      type: "date",
    },
    {
      id: "isUnread",
      label: "Unread",
      type: "boolean",
      badge: {
        show: "if-set",
        variant: "default",
      },
    },
    {
      id: "snippet",
      label: "Preview",
      type: "text",
    },
    {
      id: "messageCount",
      label: "Messages",
      type: "number",
    },
  ],

  async query(
    filters: Record<string, string>,
    cursor?: string
  ): Promise<QueryResult> {
    const query = filters.q || "in:inbox"
    const max = parseInt(filters.max || "20", 10)

    const result = await gmail.searchThreads(query, max, cursor || undefined)

    const items: PluginItem[] = result.threads.map((t: any) => ({
      id: t.id,
      subject: t.subject,
      snippet: t.snippet,
      from: t.from,
      date: t.date,
      messageCount: t.messageCount,
      isUnread: t.isUnread,
      labelIds: t.labelIds,
    }))

    return {
      items,
      nextCursor: result.nextPageToken || undefined,
    }
  },

  async detail(id: string): Promise<PluginItem> {
    const thread = await gmail.getThread(id)
    return {
      id: thread.id,
      subject: thread.subject,
      snippet: thread.snippet,
      from: thread.from,
      date: thread.date,
      messageCount: thread.messageCount,
      isUnread: thread.isUnread,
      labelIds: thread.labelIds,
      messages: thread.messages,
    }
  },

  async mutate(id: string, action: string, payload?: unknown): Promise<void> {
    switch (action) {
      case "trash":
        await gmail.trashThread(id)
        invalidate("gmail:sync:")
        invalidate(`gmail:thread:${id}`)
        break
      case "archive":
        await gmail.modifyThreadLabels(id, [], ["INBOX"])
        invalidate("gmail:sync:")
        invalidate(`gmail:thread:${id}`)
        break
      case "mark-read":
        // Gmail mark-read is per-message, not per-thread -- skip for now
        break
      case "label": {
        const p = payload as { addLabelIds?: string[]; removeLabelIds?: string[] } | undefined
        await gmail.modifyThreadLabels(id, p?.addLabelIds || [], p?.removeLabelIds || [])
        invalidate("gmail:sync:")
        invalidate(`gmail:thread:${id}`)
        break
      }
      default:
        throw new Error(`gmail: unknown action "${action}"`)
    }
  },

  // Sub-items: messages within a thread
  async querySubItems(
    threadId: string,
    _filters: Record<string, string>,
    _cursor?: string
  ): Promise<QueryResult> {
    const thread = await gmail.getThread(threadId)
    const items: PluginItem[] = thread.messages.map((m: any) => ({
      id: m.id,
      from: m.from,
      to: m.to,
      date: m.date,
      body: m.body,
      bodyIsHtml: m.bodyIsHtml,
      snippet: m.snippet,
      attachments: m.attachments,
    }))
    return { items }
  },
}

export default gmailSource
```

- [ ] **Step 2: Run tests**

Run: `cd packages/inbox && npx vitest run server/lib/__tests__/gmail-source.test.ts`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `cd packages/inbox && npm run test:ci`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add server/lib/sources/gmail-source.ts
git commit -m "feat: implement Gmail source plugin adapter"
```

---

## Chunk 3: Notion Source Plugins

Notion has two distinct views (Tasks and Calendar) backed by different Notion databases. Create two source plugins: `notion-tasks` and `notion-calendar`.

**Verified adapter functions:** The following functions used in the adapters below have been confirmed to exist in `server/lib/notion.ts`: `queryTasks()` (line 62), `getTaskDetail()` (line 168), `updateTaskProperties()` (line 195), `queryCalendarItems()` (line 253), `getCalendarItemDetail()` (line 317), `getPropertyOptions()` (line 412). If `notion.ts` is refactored before this phase runs, re-verify these function names and signatures still match before implementing the adapters.

### Task 6: Notion tasks source adapter -- test first

**Files:**
- Create: `server/lib/__tests__/notion-tasks-source.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// server/lib/__tests__/notion-tasks-source.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../notion.js", () => ({
  queryTasks: vi.fn(),
  getTaskDetail: vi.fn(),
  updateTaskProperties: vi.fn(),
  getPropertyOptions: vi.fn(() => []),
}))

const notion = await import("../notion.js")
const { default: notionTasksSource } = await import("../sources/notion-tasks-source.js")

describe("notion-tasks-source", () => {
  beforeEach(() => vi.clearAllMocks())

  it("has correct plugin metadata", () => {
    expect(notionTasksSource.id).toBe("notion-tasks")
    expect(notionTasksSource.name).toBe("Tasks")
    expect(notionTasksSource.icon).toBe("CheckSquare")
    expect(notionTasksSource.defaultView).toBe("document")
  })

  it("query() maps Notion tasks to PluginItems", async () => {
    vi.mocked(notion.queryTasks).mockResolvedValue({
      tasks: [
        {
          id: "task-1",
          title: "Fix bug",
          status: "In Progress",
          tags: ["dev"],
          priority: "High",
          assignee: "Grant",
          createdAt: "2026-03-10",
          updatedAt: "2026-03-12",
          url: "https://notion.so/task-1",
        },
      ],
      nextCursor: null,
    })

    const result = await notionTasksSource.query({})
    expect(result.items).toHaveLength(1)
    expect(result.items[0].id).toBe("task-1")
    expect(result.items[0].title).toBe("Fix bug")
    expect(result.items[0].status).toBe("In Progress")
  })

  it("query() passes filters through to queryTasks", async () => {
    vi.mocked(notion.queryTasks).mockResolvedValue({ tasks: [], nextCursor: null })

    await notionTasksSource.query({ status: "Done", assignee: "Grant" }, "cursor1")
    expect(notion.queryTasks).toHaveBeenCalledWith({
      status: "Done",
      assignee: "Grant",
      cursor: "cursor1",
    })
  })

  it("detail() calls getTaskDetail", async () => {
    vi.mocked(notion.getTaskDetail).mockResolvedValue({
      id: "task-1",
      title: "Fix bug",
      status: "In Progress",
      tags: ["dev"],
      priority: "High",
      assignee: "Grant",
      createdAt: "2026-03-10",
      updatedAt: "2026-03-12",
      url: "https://notion.so/task-1",
      body: "Description here",
      properties: {},
      children: [],
    })

    const result = await notionTasksSource.detail!("task-1")
    expect(result.id).toBe("task-1")
    expect(result.body).toBe("Description here")
  })

  it("mutate() supports update-status action", async () => {
    vi.mocked(notion.updateTaskProperties).mockResolvedValue({ ok: true })
    await notionTasksSource.mutate("task-1", "update-status", { status: "Done" })
    expect(notion.updateTaskProperties).toHaveBeenCalledWith("task-1", {
      Status: { status: { name: "Done" } },
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/inbox && npx vitest run server/lib/__tests__/notion-tasks-source.test.ts`
Expected: FAIL

- [ ] **Step 3: Commit**

```bash
git add server/lib/__tests__/notion-tasks-source.test.ts
git commit -m "test: add notion-tasks-source adapter tests"
```

### Task 7: Notion tasks source adapter -- implementation

**Files:**
- Create: `server/lib/sources/notion-tasks-source.ts`

- [ ] **Step 1: Implement the Notion tasks source plugin**

```typescript
// server/lib/sources/notion-tasks-source.ts
import * as notion from "../notion.js"
// NOTE: This import crosses the server/src boundary. This matches the existing
// pattern in plugin-loader.ts. Future cleanup: create a shared types/ directory
// at the package root so server/ and src/ both import from the same place.
import type { SourcePlugin, PluginItem, QueryResult } from "../../../src/types/plugin.js"

const notionTasksSource: SourcePlugin = {
  id: "notion-tasks",
  name: "Tasks",
  icon: "CheckSquare",
  defaultView: "document" as const,

  fieldSchema: [
    {
      id: "title",
      label: "Title",
      type: "text",
    },
    {
      id: "status",
      label: "Status",
      type: "select",
      filter: {
        filterable: true,
        filterOptions: () =>
          notion.getPropertyOptions("Status").map((o) => o.value),
      },
      badge: {
        show: "always",
        colorFn: (v: string) => {
          if (v === "Done") return "bg-chart-1/20 text-chart-1"
          if (v === "In Progress") return "bg-chart-3/20 text-chart-3"
          return "bg-muted text-muted-foreground"
        },
      },
    },
    {
      id: "priority",
      label: "Priority",
      type: "select",
      filter: {
        filterable: true,
        filterOptions: () =>
          notion.getPropertyOptions("Priority").map((o) => o.value),
      },
      badge: {
        show: "if-set",
        variant: "outline",
      },
    },
    {
      id: "tags",
      label: "Tags",
      type: "multiselect",
      filter: {
        filterable: true,
        filterOptions: () =>
          notion.getPropertyOptions("Tags").map((o) => o.value),
      },
      badge: {
        show: "if-set",
        variant: "secondary",
      },
    },
    {
      id: "assignee",
      label: "Assignee",
      type: "text",
      filter: { filterable: true },
    },
    {
      id: "updatedAt",
      label: "Updated",
      type: "date",
    },
  ],

  async query(
    filters: Record<string, string>,
    cursor?: string
  ): Promise<QueryResult> {
    const result = await notion.queryTasks({
      status: filters.status || undefined,
      tags: filters.tags || undefined,
      assignee: filters.assignee || undefined,
      priority: filters.priority || undefined,
      cursor: cursor || undefined,
    })

    const items: PluginItem[] = result.tasks.map((t: any) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      tags: t.tags,
      priority: t.priority,
      assignee: t.assignee,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      url: t.url,
    }))

    return {
      items,
      nextCursor: result.nextCursor || undefined,
    }
  },

  async detail(id: string): Promise<PluginItem> {
    const task = await notion.getTaskDetail(id)
    return {
      id: task.id,
      title: task.title,
      status: task.status,
      tags: task.tags,
      priority: task.priority,
      assignee: task.assignee,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      url: task.url,
      body: task.body,
      properties: task.properties,
      children: task.children,
    }
  },

  async mutate(id: string, action: string, payload?: unknown): Promise<void> {
    switch (action) {
      case "update-status": {
        const p = payload as { status: string }
        await notion.updateTaskProperties(id, {
          Status: { status: { name: p.status } },
        })
        break
      }
      case "update-priority": {
        const p = payload as { priority: string }
        await notion.updateTaskProperties(id, {
          Priority: { select: { name: p.priority } },
        })
        break
      }
      case "update-assignee": {
        const p = payload as { assignee: string }
        await notion.updateTaskProperties(id, {
          Assignee: { people: [{ object: "user", id: p.assignee }] },
        })
        break
      }
      default:
        throw new Error(`notion-tasks: unknown action "${action}"`)
    }
  },
}

export default notionTasksSource
```

- [ ] **Step 2: Run tests**

Run: `cd packages/inbox && npx vitest run server/lib/__tests__/notion-tasks-source.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add server/lib/sources/notion-tasks-source.ts
git commit -m "feat: implement Notion tasks source plugin adapter"
```

### Task 8: Notion calendar source adapter

**Files:**
- Create: `server/lib/sources/notion-calendar-source.ts`

- [ ] **Step 1: Implement the Notion calendar source plugin**

Follow the same pattern as `notion-tasks-source.ts` but wrapping `notion.queryCalendarItems()` and `notion.getCalendarItemDetail()`. Key differences:

```typescript
// server/lib/sources/notion-calendar-source.ts
import * as notion from "../notion.js"
// NOTE: This import crosses the server/src boundary. This matches the existing
// pattern in plugin-loader.ts. Future cleanup: create a shared types/ directory
// at the package root so server/ and src/ both import from the same place.
import type { SourcePlugin, PluginItem, QueryResult } from "../../../src/types/plugin.js"

const notionCalendarSource: SourcePlugin = {
  id: "notion-calendar",
  name: "Calendar",
  icon: "Calendar",
  defaultView: "document" as const,

  fieldSchema: [
    { id: "title", label: "Title", type: "text" },
    {
      id: "date",
      label: "Date",
      type: "date",
      badge: { show: "always", variant: "outline" },
    },
    {
      id: "status",
      label: "Status",
      type: "select",
      filter: {
        filterable: true,
        filterOptions: () =>
          notion.getPropertyOptions("calendar:Status").map((o) => o.value),
      },
      badge: {
        show: "if-set",
        colorFn: (v: string) => {
          if (v === "Done") return "bg-chart-1/20 text-chart-1"
          if (v === "In Progress") return "bg-chart-3/20 text-chart-3"
          return "bg-muted text-muted-foreground"
        },
      },
    },
    {
      id: "tags",
      label: "Tags",
      type: "multiselect",
      filter: {
        filterable: true,
        filterOptions: () =>
          notion.getPropertyOptions("calendar:Tags").map((o) => o.value),
      },
      badge: { show: "if-set", variant: "secondary" },
    },
    {
      id: "assignee",
      label: "Assignee",
      type: "text",
      filter: { filterable: true },
    },
    { id: "updatedAt", label: "Updated", type: "date" },
  ],

  async query(
    filters: Record<string, string>,
    cursor?: string
  ): Promise<QueryResult> {
    const result = await notion.queryCalendarItems({
      status: filters.status || undefined,
      tags: filters.tags || undefined,
      assignee: filters.assignee || undefined,
      cursor: cursor || undefined,
    })

    const items: PluginItem[] = result.items.map((item: any) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      tags: item.tags,
      assignee: item.assignee,
      date: item.date,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      url: item.url,
    }))

    return {
      items,
      nextCursor: result.nextCursor || undefined,
    }
  },

  async detail(id: string): Promise<PluginItem> {
    const item = await notion.getCalendarItemDetail(id)
    return {
      id: item.id,
      title: item.title,
      status: item.status,
      tags: item.tags,
      assignee: item.assignee,
      date: item.date,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      url: item.url,
      body: item.body,
      properties: item.properties,
      children: item.children,
    }
  },

  async mutate(id: string, action: string, payload?: unknown): Promise<void> {
    switch (action) {
      case "update-status": {
        const p = payload as { status: string }
        await notion.updateTaskProperties(id, {
          Status: { status: { name: p.status } },
        })
        break
      }
      default:
        throw new Error(`notion-calendar: unknown action "${action}"`)
    }
  },
}

export default notionCalendarSource
```

- [ ] **Step 2: Run tests**

Run: `cd packages/inbox && npm run test:ci`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add server/lib/sources/notion-calendar-source.ts
git commit -m "feat: implement Notion calendar source plugin adapter"
```

---

## Chunk 4: Built-in Plugin Registration

Register Gmail, Notion tasks, and Notion calendar as built-in plugins in the plugin-loader so they appear alongside workspace plugins. The existing bespoke routes stay mounted for backward compatibility.

### Task 9: Add built-in plugin registration to plugin-loader

**Files:**
- Modify: `server/lib/plugin-loader.ts`
- Modify: `server/index.ts`
- Modify: `server/lib/__tests__/plugin-loader.test.ts`

- [ ] **Step 1: Add registerBuiltIn function and update getPlugins/getPlugin**

In `plugin-loader.ts`, add a separate `builtInPlugins` map and a `registerBuiltIn` function:

```typescript
const builtInPlugins = new Map<string, SourcePlugin>()

/**
 * Register a built-in source plugin (Gmail, Notion, etc.).
 * Built-in plugins are always present -- they don't depend on workspace files.
 */
export function registerBuiltIn(plugin: SourcePlugin): void {
  builtInPlugins.set(plugin.id, plugin)
}
```

Update `getPlugins` to include built-ins first:

```typescript
export function getPlugins(): SourcePlugin[] {
  return [...builtInPlugins.values(), ...registry.values()]
}
```

Update `getPlugin` to check built-ins:

```typescript
export function getPlugin(id: string): SourcePlugin | undefined {
  return builtInPlugins.get(id) || registry.get(id)
}
```

- [ ] **Step 2: Register built-in sources at server startup**

In `server/index.ts`, after the `loadCredentials` call, add:

```typescript
import { registerBuiltIn } from "./lib/plugin-loader.js"
import gmailSource from "./lib/sources/gmail-source.js"
import notionTasksSource from "./lib/sources/notion-tasks-source.js"
import notionCalendarSource from "./lib/sources/notion-calendar-source.js"

// Register built-in source plugins
registerBuiltIn(gmailSource)
registerBuiltIn(notionTasksSource)
registerBuiltIn(notionCalendarSource)
```

- [ ] **Step 3: Update plugin-loader tests**

In `server/lib/__tests__/plugin-loader.test.ts`, add a new `describe("registerBuiltIn")` block:

```typescript
describe("registerBuiltIn", () => {
  it("makes the plugin available via getPlugin and getPlugins", async () => {
    fsMock.readdir.mockResolvedValue([])
    await loadPlugins("/fake/workspace")

    const { registerBuiltIn } = await import("../plugin-loader.js")
    const builtin = makePlugin({ id: "gmail", name: "Emails" })
    registerBuiltIn(builtin)

    expect(getPlugin("gmail")).toBe(builtin)
    expect(getPlugins()).toContain(builtin)
  })

  it("built-in plugins appear before workspace plugins in getPlugins", async () => {
    const { registerBuiltIn } = await import("../plugin-loader.js")
    const builtin = makePlugin({ id: "gmail", name: "Emails" })
    registerBuiltIn(builtin)

    fsMock.readdir.mockResolvedValue(["ext.ts"])
    const ext = makePlugin({ id: "ext", name: "External" })
    await loadPlugins("/fake/workspace", makeImporter({ "ext.ts": ext }))

    const plugins = getPlugins()
    const ids = plugins.map((p) => p.id)
    expect(ids.indexOf("gmail")).toBeLessThan(ids.indexOf("ext"))
  })
})
```

- [ ] **Step 4: Run tests**

Run: `cd packages/inbox && npm run test:ci`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/lib/plugin-loader.ts server/index.ts server/lib/__tests__/plugin-loader.test.ts
git commit -m "feat: register Gmail, Notion tasks, and Notion calendar as built-in source plugins"
```

---

## Chunk 5: Unified Sidebar Sources

Merge the hardcoded "Sources" section and the dynamic "Plugins" section into a single "Sources" section. Built-in sources (Gmail, Notion tasks, Notion calendar) use their existing emoji icons. Workspace plugins use a plug icon.

### Task 10: Unify sidebar sources section

**Files:**
- Modify: `src/components/layout/AppSidebar.tsx`

- [ ] **Step 1: Replace hardcoded navItems with plugin-driven list**

Replace the hardcoded `navItems` array and the separate "Plugins" section with a single "Sources" section that renders all plugins (built-in + workspace):

```typescript
// Replace the navItems constant with:
const BUILTIN_ICONS: Record<string, { emoji: string; tab: TabId | null }> = {
  "gmail": { emoji: "\u2709\uFE0F", tab: "emails" },
  "notion-tasks": { emoji: "\u2705", tab: "tasks" },
  "notion-calendar": { emoji: "\uD83D\uDCC5", tab: "calendar" },
}
```

In the JSX, replace both the hardcoded Sources `SidebarGroup` and the Plugins `SidebarGroup` with a single group:

```tsx
<SidebarGroup>
  <SidebarGroupLabel>Sources</SidebarGroupLabel>
  <SidebarGroupContent>
    <SidebarMenu>
      {(plugins ?? []).map((plugin) => {
        const builtin = BUILTIN_ICONS[plugin.id]
        const isActive = builtin?.tab
          ? !isRecentRoute && location.pathname.startsWith(`/${builtin.tab}`)
          : location.pathname.startsWith(`/plugins/${plugin.id}`)

        return (
          <SidebarMenuItem key={plugin.id}>
            <SidebarMenuButton
              isActive={isActive}
              tooltip={plugin.name}
              className={cn(isActive && "bg-accent text-accent-foreground font-medium")}
              onClick={() => {
                if (builtin?.tab) {
                  navigateToTab(builtin.tab)
                } else {
                  navigate(`/plugins/${plugin.id}`)
                }
                if (isMobile) setOpenMobile(false)
              }}
            >
              <span>{builtin?.emoji ?? "\uD83D\uDD0C"}</span>
              <span>{plugin.name}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )
      })}
    </SidebarMenu>
  </SidebarGroupContent>
</SidebarGroup>
```

Remove the separate `{plugins && plugins.length > 0 && (` block for the old Plugins section.

- [ ] **Step 2: Run tests**

Run: `cd packages/inbox && npm run test:ci`
Expected: PASS

- [ ] **Step 3: Manual verification**

1. Start the dev server: `cd packages/inbox && npm run dev -- --workspace ~/Github/hammies/hammies-agent`
2. Sidebar should show a single "Sources" section with: Emails, Tasks, Calendar, and any workspace plugins
3. Clicking Emails/Tasks/Calendar still navigates to their existing dedicated views
4. Clicking a workspace plugin navigates to `/plugins/:id`
5. No separate "Plugins" section in the sidebar

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/AppSidebar.tsx
git commit -m "feat: unify sidebar into single Sources section for all plugins"
```

---

## Chunk 6: Slack Source Plugin

Build the first new source plugin: Slack. Uses the Slack Web API directly (no dependency on the agent skill -- the inbox server calls Slack APIs itself using `SLACK_BOT_TOKEN` from the workspace `.env`).

### Task 11: Slack source plugin -- test first

**Files:**
- Create: `server/lib/__tests__/slack-source.test.ts`

- [ ] **Step 1: Write tests for the Slack source plugin**

```typescript
// server/lib/__tests__/slack-source.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal("fetch", mockFetch)

// Mock process.env
vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-test-token")

const { default: slackSource } = await import("../sources/slack-source.js")

function mockSlackResponse(data: Record<string, unknown>) {
  return {
    ok: true,
    json: async () => ({ ok: true, ...data }),
  }
}

describe("slack-source", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("has correct plugin metadata", () => {
    expect(slackSource.id).toBe("slack")
    expect(slackSource.name).toBe("Slack")
    expect(slackSource.icon).toBe("MessageSquare")
    expect(slackSource.defaultView).toBe("conversation")
    expect(slackSource.querySubItems).toBeDefined()
  })

  it("query() lists channels with unread counts", async () => {
    mockFetch.mockResolvedValueOnce(
      mockSlackResponse({
        channels: [
          {
            id: "C123",
            name: "general",
            is_im: false,
            is_mpim: false,
            is_private: false,
            unread_count: 5,
            latest: { ts: "1700000000.123456", text: "Hello everyone" },
            topic: { value: "General discussion" },
          },
          {
            id: "C456",
            name: "random",
            is_im: false,
            is_mpim: false,
            is_private: false,
            unread_count: 0,
            latest: { ts: "1700000000.000000", text: "..." },
            topic: { value: "" },
          },
        ],
        response_metadata: { next_cursor: "" },
      })
    )

    const result = await slackSource.query({})
    expect(result.items).toHaveLength(2)
    expect(result.items[0].id).toBe("C123")
    expect(result.items[0].channelName).toBe("general")
    expect(result.items[0].unreadCount).toBe(5)
    expect(result.items[0].latestText).toBe("Hello everyone")
  })

  it("query() filters to unread-only when filter is set", async () => {
    mockFetch.mockResolvedValueOnce(
      mockSlackResponse({
        channels: [
          { id: "C123", name: "general", is_im: false, is_mpim: false, is_private: false, unread_count: 5, latest: { ts: "1", text: "hi" }, topic: { value: "" } },
          { id: "C456", name: "random", is_im: false, is_mpim: false, is_private: false, unread_count: 0, latest: { ts: "1", text: "..." }, topic: { value: "" } },
        ],
        response_metadata: { next_cursor: "" },
      })
    )

    const result = await slackSource.query({ unread: "true" })
    expect(result.items).toHaveLength(1)
    expect(result.items[0].id).toBe("C123")
  })

  it("querySubItems() fetches channel messages", async () => {
    mockFetch.mockResolvedValueOnce(
      mockSlackResponse({
        messages: [
          { ts: "1700000000.111", text: "Hello", user: "U111" },
          { ts: "1700000000.222", text: "World", user: "U222" },
        ],
        has_more: false,
        response_metadata: { next_cursor: "" },
      })
    )

    const result = await slackSource.querySubItems!("C123", {})
    expect(result.items).toHaveLength(2)
    expect(result.items[0].id).toBe("1700000000.111")
    expect(result.items[0].text).toBe("Hello")
    expect(result.items[0].userId).toBe("U111")
  })

  it("mutate() supports post-message action", async () => {
    mockFetch.mockResolvedValueOnce(
      mockSlackResponse({ channel: "C123", ts: "1700000000.333" })
    )

    await slackSource.mutate("C123", "post-message", { text: "Test message" })

    expect(mockFetch).toHaveBeenCalledWith(
      "https://slack.com/api/chat.postMessage",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"text":"Test message"'),
      })
    )
  })

  it("mutate() supports mark-read action", async () => {
    mockFetch.mockResolvedValueOnce(mockSlackResponse({}))

    await slackSource.mutate("C123", "mark-read", { ts: "1700000000.999" })

    expect(mockFetch).toHaveBeenCalledWith(
      "https://slack.com/api/conversations.mark",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"channel":"C123"'),
      })
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/inbox && npx vitest run server/lib/__tests__/slack-source.test.ts`
Expected: FAIL -- cannot find `../sources/slack-source.js`

- [ ] **Step 3: Commit**

```bash
git add server/lib/__tests__/slack-source.test.ts
git commit -m "test: add Slack source plugin tests"
```

### Task 12: Slack source plugin -- implementation

**Files:**
- Create: `server/lib/sources/slack-source.ts`

- [ ] **Step 1: Implement the Slack source plugin**

```typescript
// server/lib/sources/slack-source.ts
// NOTE: This import crosses the server/src boundary. This matches the existing
// pattern in plugin-loader.ts. Future cleanup: create a shared types/ directory
// at the package root so server/ and src/ both import from the same place.
import type { SourcePlugin, PluginItem, QueryResult } from "../../../src/types/plugin.js"

const SLACK_API = "https://slack.com/api"

function getToken(): string {
  const token = process.env.SLACK_BOT_TOKEN
  if (!token) throw new Error("SLACK_BOT_TOKEN not set in workspace .env")
  return token
}

async function slackPost(method: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!data.ok) {
    throw new Error(`Slack API error (${method}): ${data.error || JSON.stringify(data)}`)
  }
  return data
}

const slackSource: SourcePlugin = {
  id: "slack",
  name: "Slack",
  icon: "MessageSquare",
  defaultView: "conversation" as const,

  fieldSchema: [
    {
      id: "channelName",
      label: "Channel",
      type: "text",
    },
    {
      id: "channelType",
      label: "Type",
      type: "select",
      filter: {
        filterable: true,
        filterOptions: ["public_channel", "private_channel", "dm", "group_dm"],
      },
      badge: {
        show: "if-set",
        variant: "outline",
      },
    },
    {
      id: "unreadCount",
      label: "Unread",
      type: "number",
      badge: {
        show: "if-set",
        variant: "default",
      },
    },
    {
      id: "latestText",
      label: "Latest",
      type: "text",
    },
    {
      id: "latestTs",
      label: "Last Activity",
      type: "date",
    },
    {
      id: "topic",
      label: "Topic",
      type: "text",
    },
  ],

  async query(
    filters: Record<string, string>,
    cursor?: string
  ): Promise<QueryResult> {
    const types = filters.types || "public_channel,private_channel,im,mpim"
    const limit = parseInt(filters.limit || "200", 10)

    const body: Record<string, unknown> = {
      types,
      limit,
      exclude_archived: true,
    }
    if (cursor) body.cursor = cursor

    const result = await slackPost("users.conversations", body)

    let channels: any[] = result.channels || []

    // Filter to unread-only if requested
    if (filters.unread === "true") {
      channels = channels.filter((ch: any) => {
        const count = ch.unread_count || ch.unread_count_display || 0
        return count > 0
      })
    }

    const items: PluginItem[] = channels.map((ch: any) => ({
      id: ch.id,
      channelName: ch.name || ch.user || ch.id,
      channelType: ch.is_im
        ? "dm"
        : ch.is_mpim
          ? "group_dm"
          : ch.is_private
            ? "private_channel"
            : "public_channel",
      unreadCount: ch.unread_count || ch.unread_count_display || 0,
      latestTs: ch.latest?.ts || null,
      latestText: ch.latest?.text || null,
      topic: ch.topic?.value || "",
      memberCount: ch.num_members || null,
    }))

    const nextCursor = result.response_metadata?.next_cursor || undefined

    return { items, nextCursor: nextCursor || undefined }
  },

  // Sub-items: messages within a channel
  async querySubItems(
    channelId: string,
    filters: Record<string, string>,
    cursor?: string
  ): Promise<QueryResult> {
    const limit = parseInt(filters.limit || "50", 10)
    const body: Record<string, unknown> = { channel: channelId, limit }
    if (cursor) body.cursor = cursor
    if (filters.oldest) body.oldest = filters.oldest

    const result = await slackPost("conversations.history", body)

    const items: PluginItem[] = (result.messages || []).map((msg: any) => ({
      id: msg.ts,
      text: msg.text || "",
      userId: msg.user || msg.bot_id || "unknown",
      userName: msg.username || null,
      ts: msg.ts,
      threadTs: msg.thread_ts || null,
      replyCount: msg.reply_count || 0,
      reactions: msg.reactions || [],
      subtype: msg.subtype || null,
    }))

    const nextCursor = result.response_metadata?.next_cursor || undefined

    return { items, nextCursor: nextCursor || undefined }
  },

  async mutate(id: string, action: string, payload?: unknown): Promise<void> {
    const p = (payload || {}) as Record<string, unknown>

    switch (action) {
      case "post-message":
        await slackPost("chat.postMessage", {
          channel: id,
          text: p.text as string,
          ...(p.threadTs ? { thread_ts: p.threadTs } : {}),
        })
        break
      case "mark-read":
        await slackPost("conversations.mark", {
          channel: id,
          ts: p.ts as string,
        })
        break
      case "add-reaction":
        await slackPost("reactions.add", {
          channel: id,
          timestamp: p.ts as string,
          name: p.emoji as string,
        })
        break
      default:
        throw new Error(`slack: unknown action "${action}"`)
    }
  },
}

export default slackSource
```

- [ ] **Step 2: Run tests**

Run: `cd packages/inbox && npx vitest run server/lib/__tests__/slack-source.test.ts`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `cd packages/inbox && npm run test:ci`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add server/lib/sources/slack-source.ts
git commit -m "feat: implement Slack source plugin"
```

### Task 13: Register Slack as a built-in source (conditional)

**Files:**
- Modify: `server/index.ts`

- [ ] **Step 1: Conditionally register Slack if credentials are available**

After the existing `registerBuiltIn` calls, add:

```typescript
// Register Slack only if credentials are available
if (process.env.SLACK_BOT_TOKEN) {
  import("./lib/sources/slack-source.js").then(({ default: slackSource }) => {
    registerBuiltIn(slackSource)
    console.log("Registered built-in source: Slack")
  }).catch((err) => console.warn("Failed to load Slack source:", err.message))
}
```

- [ ] **Step 2: Run tests**

Run: `cd packages/inbox && npm run test:ci`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add server/index.ts
git commit -m "feat: conditionally register Slack source when SLACK_BOT_TOKEN is set"
```

---

## Chunk 7: Plugin Detail View Improvements

Enhance `PluginDetail` to use the `detail()` endpoint when available, and add a conversation-style view for sources with `defaultView: "conversation"`.

### Task 14: Fetch detail from server when plugin has detail()

**Files:**
- Modify: `src/components/plugin/PluginDetail.tsx`
- Modify: `src/api/client.ts`
- Modify: `server/routes/plugins.ts`

- [ ] **Step 1: Expose hasDetail and defaultView in plugin manifest**

Update the `PluginManifest` type in `src/api/client.ts`:

```typescript
export interface PluginManifest {
  id: string
  name: string
  icon: string
  fieldSchema: import("@/types/plugin").FieldDef[]
  detailSchema?: import("@/types/panels").WidgetDef[]
  hasSubItems?: boolean
  hasDetail?: boolean
  defaultView?: "conversation" | "table" | "document" | "card"
}
```

Update the plugin manifest serialization in `server/routes/plugins.ts` (the `GET /` handler):

```typescript
pluginRoutes.get("/", (c) => {
  const plugins = getPlugins().map((p) => ({
    id: p.id,
    name: p.name,
    icon: p.icon,
    fieldSchema: p.fieldSchema,
    detailSchema: p.detailSchema,
    hasSubItems: !!p.querySubItems,
    hasDetail: !!p.detail,
    defaultView: p.defaultView,
  }))
  return c.json(plugins)
})
```

- [ ] **Step 2: Update PluginDetail to conditionally fetch detail**

In `PluginDetail.tsx`, import and use the detail hook:

```typescript
import { usePlugins, usePluginItems, usePluginSubItems, usePluginItemDetail } from "@/hooks/use-plugins"

// Inside PluginDetail component, after getting the plugin:
const hasDetail = !!plugin?.hasDetail
const { data: detailData, isLoading: detailLoading } = usePluginItemDetail(
  pluginId,
  itemId,
  hasDetail
)

// For the widget tree path, prefer detail data over list data:
const item = hasDetail
  ? (detailData as Record<string, unknown> | undefined)
  : (itemsData?.items.find((i) => i.id === itemId) as Record<string, unknown> | undefined)

const isItemLoading = hasDetail ? detailLoading : itemsLoading
```

- [ ] **Step 3: Run tests**

Run: `cd packages/inbox && npm run test:ci`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/plugin/PluginDetail.tsx src/api/client.ts server/routes/plugins.ts
git commit -m "feat: use detail() endpoint in PluginDetail when available"
```

### Task 15: Conversation view for email and Slack detail

**Files:**
- Create: `src/components/plugin/PluginConversationView.tsx`
- Modify: `src/components/plugin/PluginDetail.tsx`

- [ ] **Step 1: Create PluginConversationView component**

This is a generic conversation renderer that works for email threads and Slack channels. It uses `usePluginSubItems` to fetch messages, then renders each as a message bubble with sender, timestamp, and body. Email bodies that are HTML are rendered using a sanitized iframe or a prose container (the HTML is already sanitized by the Gmail sanitizer on the server side). Slack messages are rendered as plain text with basic formatting.

Key implementation points:
- Import `usePluginSubItems` from `@/hooks/use-plugins`
- Render a scrollable list of messages with sender name, timestamp, and body
- For HTML bodies (`bodyIsHtml === true`), render in a sanitized container
- For plain text, render with `whitespace-pre-wrap`
- Use `PanelHeader` and `SidebarButton` for consistent layout

- [ ] **Step 2: Route to PluginConversationView for conversation-type plugins**

In `PluginDetail.tsx`, add logic to use the conversation view when the plugin's `defaultView` is `"conversation"` and it has sub-items:

```typescript
import { PluginConversationView } from "./PluginConversationView"

// At the top of the PluginDetail component, after getting the plugin:
const isConversation = plugin?.defaultView === "conversation" && plugin?.hasSubItems

if (isConversation) {
  return (
    <PluginConversationView
      pluginId={pluginId}
      itemId={itemId}
      title={parentTitle || itemId}
    />
  )
}
```

This replaces the existing `hasSubItems` check. Remove or update the old sub-items rendering block to be the fallback for non-conversation sub-item views.

- [ ] **Step 3: Run tests**

Run: `cd packages/inbox && npm run test:ci`
Expected: PASS

- [ ] **Step 4: Manual verification**

1. Navigate to `/plugins/slack/C123` -- should show channel messages in conversation view
2. Navigate to `/plugins/gmail/thread-1` -- should show email thread in conversation view
3. Navigate to `/plugins/notion-tasks/task-1` -- should show document-style detail view
4. All existing plugin views still work

- [ ] **Step 5: Commit**

```bash
git add src/components/plugin/PluginConversationView.tsx src/components/plugin/PluginDetail.tsx
git commit -m "feat: add PluginConversationView for email/Slack-style detail views"
```

---

## Chunk 8: Register Source Plugins as Tabs (using Phase 4 Tab/Panel API)

**Prerequisite:** Phase 4's TabGrid/Tab/Panel component system must be complete. This chunk uses the declarative Tab/Panel API -- it does NOT modify PanelStack internals or the router directly.

Each source plugin registers as a `<Tab>` with `<Panel>` children for list and detail views. The TabGrid (from Phase 4) handles navigation, panel layout, and back/forward. Built-in sources (Gmail, Notion, Slack) are rendered identically to workspace plugins.

### Task 16: Register source plugins as Tab/Panel components

**Files:**
- Modify: `src/App.tsx` (or wherever TabGrid is rendered)
- Modify: `src/components/plugin/PluginView.tsx`
- Modify: `src/components/plugin/PluginList.tsx`

- [ ] **Step 1: Render each plugin as a Tab with list and detail Panels**

In the component that renders TabGrid (likely `App.tsx` or a layout wrapper), map all registered plugins into Tab/Panel declarations:

```tsx
import { TabGrid, Tab, Panel } from "@/components/layout/TabGrid"

{(plugins ?? []).map((plugin) => (
  <Tab id={plugin.id} key={plugin.id}>
    <Panel id="list"><PluginList sourceId={plugin.id} /></Panel>
    <Panel id="detail"><PluginDetail sourceId={plugin.id} /></Panel>
  </Tab>
))}
```

Built-in sources like Gmail, Notion tasks, and Notion calendar are already registered as plugins (from Chunk 4), so they appear here automatically -- no special-casing needed.

- [ ] **Step 2: Preserve URL aliases for built-in tabs**

Map the legacy URL patterns (`/emails`, `/tasks`, `/calendar`) to the corresponding plugin tab IDs so deep links and bookmarks continue to work:

```typescript
const TAB_ALIASES: Record<string, string> = {
  "emails": "gmail",
  "tasks": "notion-tasks",
  "calendar": "notion-calendar",
}
```

Pass these aliases to TabGrid (or handle them in the Tab resolution logic from Phase 4) so that navigating to `/emails` activates the `gmail` tab, `/tasks` activates `notion-tasks`, etc.

- [ ] **Step 3: Update PluginList and PluginDetail to accept sourceId prop**

Instead of reading the plugin ID from route params, accept it as a prop (passed by the Panel):

```typescript
export function PluginList({ sourceId }: { sourceId: string }) {
  // Use sourceId directly instead of useParams
  const { data: plugins } = usePlugins()
  const plugin = plugins?.find((p) => p.id === sourceId)
  // ...
}
```

Do the same for `PluginDetail`. Navigation within a plugin (e.g., clicking a list item to open detail) should use the Tab/Panel navigation API from Phase 4, not `react-router` `navigate()`.

- [ ] **Step 4: Do NOT modify PanelStack**

PanelStack continues to handle sessions and any non-plugin views. Source plugins are entirely managed by TabGrid. No imports, rendering logic, or tab handlers need to be added to or removed from PanelStack.

- [ ] **Step 5: Run tests**

Run: `cd packages/inbox && npm run test:ci`
Expected: PASS

- [ ] **Step 6: Manual verification**

1. Navigate to `/emails` -- shows Gmail plugin list view (via TabGrid)
2. Click an email thread -- opens detail Panel, shows conversation view
3. Navigate to `/tasks` -- shows Notion tasks plugin list view
4. Click a task -- opens detail Panel, shows document detail view
5. Navigate to `/calendar` -- shows calendar items
6. Sidebar "Sources" links still work correctly
7. Sessions tab still works via PanelStack (unmodified)
8. Browser back/forward navigation works through Tab/Panel API
9. Workspace plugins also appear as tabs alongside built-in sources

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/components/plugin/PluginView.tsx src/components/plugin/PluginList.tsx
git commit -m "feat: register source plugins as Tab/Panel components using Phase 4 TabGrid API"
```

---

## Chunk 9: Deprecation Layer for Bespoke Routes

The existing `gmailRoutes` and `notionRoutes` remain mounted for backward compatibility (the old email/task/calendar components still call them). In this chunk, we mark them as deprecated and plan their eventual removal.

### Task 17: Add deprecation comments and plan

**Files:**
- Modify: `server/routes/gmail.ts`
- Modify: `server/routes/notion.ts`

- [ ] **Step 1: Add deprecation headers to both route files**

At the top of `server/routes/gmail.ts`:

```typescript
/**
 * @deprecated Gmail data is now served through the unified plugin system via
 * /api/plugins/gmail/*. These routes remain for backward compatibility with
 * the legacy EmailList and EmailThread components. Remove once all frontend
 * components use the plugin API.
 */
```

At the top of `server/routes/notion.ts`:

```typescript
/**
 * @deprecated Notion data is now served through the unified plugin system via
 * /api/plugins/notion-tasks/* and /api/plugins/notion-calendar/*. These routes
 * remain for backward compatibility with the legacy TaskList, TaskDetail,
 * CalendarList, and CalendarDetail components. Remove once all frontend
 * components use the plugin API.
 */
```

- [ ] **Step 2: Commit**

```bash
git add server/routes/gmail.ts server/routes/notion.ts
git commit -m "chore: mark bespoke Gmail and Notion routes as deprecated"
```

---

## Chunk 10: Remove Legacy Components (optional, do after verification)

Once the plugin-based views are verified working, remove the bespoke email/task/calendar components and their dedicated API client functions. This is a cleanup step -- skip if the plugin views need more polish first.

### Task 18: Remove legacy frontend components

**Files to remove:**
- `src/components/email/EmailList.tsx`
- `src/components/email/EmailThread.tsx`
- `src/components/task/TaskList.tsx`
- `src/components/task/TaskDetail.tsx`
- `src/components/task/CalendarList.tsx`
- `src/components/task/CalendarDetail.tsx`

**Files to modify:**
- `src/hooks/use-spatial-nav.tsx` -- update `TabId` to be dynamic rather than hardcoded
- `src/api/client.ts` -- remove `searchEmails`, `getEmailThread`, `getTasks`, `getTask`, etc.

**Note:** PanelStack does NOT need modification here -- source plugins were registered as Tab/Panel components in Chunk 8 and PanelStack was never modified in this phase.

**Important:** Only do this step after thorough testing confirms the plugin views fully replace the legacy views. The legacy views have features (inline reply, label management, drag to archive) that the generic plugin views may not yet support.

- [ ] **Step 1: Audit feature parity**

Before removing, verify the plugin views support:
- Email: thread display, inline reply, trash, archive, label modification, attachment viewing
- Tasks: task detail with Notion block rendering, status/priority/assignee updates, task creation
- Calendar: calendar detail with Notion block rendering, status updates

If any features are missing, either add them to the plugin system first or defer this cleanup step.

- [ ] **Step 2: Remove components and update imports**

(Only if feature parity is confirmed)

- [ ] **Step 3: Run tests and manual verification**

Run: `cd packages/inbox && npm run test:ci`

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor: remove legacy email/task/calendar components in favor of plugin views"
```

---

## Final Verification

- [ ] **Run full test suite**: `cd packages/inbox && npm run test:ci`
- [ ] **Manual smoke test**:
  - Sidebar shows unified "Sources" section with Emails, Tasks, Calendar, Slack
  - Each source loads its list view through the plugin system
  - Email threads display in conversation view
  - Slack channels display in conversation view with messages
  - Task and calendar items display in document view with detail data
  - Filters work on all sources
  - Mutations work (trash email, mark Slack read, update task status)
  - Sessions tab still works via PanelStack
  - No console errors
- [ ] **Update TODO.md**: Mark Phase 5 items as done
- [ ] **Update PLAN.md**: Mark Phase 5 checkboxes as complete
- [ ] **Sync PLAN.md SourcePlugin interface**: Update PLAN.md's Phase 5 section so its `SourcePlugin` interface description matches the actual interface used in the implementation. The PLAN.md originally proposed `list`, `detail`, `subscribe`, `defaultView` as the interface, but the implementation extends the existing `query()`/`mutate()`/`fieldSchema`/`detailSchema`/`querySubItems()` interface with `detail()`, `subscribe()`, and `defaultView`. Ensure the PLAN.md reflects the final interface shape, method signatures, and any deviations that occurred during implementation.

---

## Future Work (separate plans)

These are follow-on tasks that build on the plugin system but are out of scope for this phase:

- **GitHub source plugin** -- `github-issues-source.ts` using GitHub REST API, mapped to SourcePlugin
- **Google Drive source plugin** -- file list + preview, document detail
- **Gorgias source plugin** -- customer support tickets, conversation view
- **Shopify source plugin** -- orders, products, customers
- **Webhook subscriptions** -- implement `subscribe()` for real-time push updates
- **Plugin settings UI** -- enable/disable sources, configure credentials per plugin
- **Feature parity cleanup** -- remove legacy email/task/calendar components once plugin views fully replace them (Task 18)
