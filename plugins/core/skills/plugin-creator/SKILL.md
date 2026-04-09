---
name: plugin-creator
description: Creates inbox plugins that connect external services to the unified inbox. Use when user says "create a plugin for X", "add X to the inbox", "connect X to inbox", "build an inbox plugin for X", or wants to add a new data source or integration to the Inbox app.
---

# Inbox Plugin Creator

Creates a TypeScript `Plugin` that appears as a new source tab in the unified inbox. Plugins can list items, show detail views, handle mutations (archive, reply, mark-done), and link items to agent sessions.

Plugins live at `{workspace}/plugins/{id}/plugin.ts`. The inbox server scans this directory on startup and auto-generates REST routes at `/api/{pluginId}/*`.

See `references/plugin-interface.md` for the complete type reference, `references/patterns.md` for common implementation patterns, and `references/slack-plugin-example.md` for a fully annotated real-world example.

## Workflow

### Step 0 — Check for existing skills

Before building a plugin, check if an existing skill covers the service's API:

```bash
ls skills/*/SKILL.md  # e.g., skills/gorgias/SKILL.md, skills/slack/SKILL.md
```

If a skill exists, reuse its API patterns, auth setup, and client code. The skill's `scripts/client.js` is a working reference for every API call you'll need.

#### Translating a skill to a plugin

When an existing skill covers the service, map its commands to Plugin methods:

| Skill command pattern | Plugin method | Notes |
|----------------------|---------------|-------|
| `list-*`, `search-*` | `query()` | Map response fields → PluginItem fields via fieldSchema |
| `get-*` (single item) | `getItem()` | Full detail for one item |
| `get-*` (child items, e.g. ticket messages) | `querySubItems()` | Parent→child relationship |
| `create-*`, `update-*`, `reply-*` | `mutate()` | Each becomes a named action |
| Dynamic option lists | `filterOptions` | Fetch available statuses, assignees, etc. |

To find the skill's auth and env vars:
1. Read `skills/{service}/scripts/client.js` — look for `process.env.*` at the top
2. Check `skills/{service}/lib/auth.js` if it exists — shows the auth pattern
3. Copy the base URL and auth header pattern into your plugin's API helper

### Step 1 — Research the API

If no existing skill exists, web search for: `{source} API documentation`, `{source} REST API authentication`, `{source} API rate limits`

Identify:
- Base URL and authentication method (API key, OAuth token, Bearer token)
- Primary list/search endpoint (what returns the "items" that appear in the inbox)
- Key fields on each item (id, title/name, timestamps, status, author, body)
- Available actions (archive, mark read, reply, label, etc.)
- Pagination style (cursor, offset, or page-based)
- Rate limits
- **Filter parameters**: Which query params does the list endpoint actually accept? Many APIs don't support all the filter fields you'd expect. Test with curl before hardcoding server-side filter params. When in doubt, fetch unfiltered and filter client-side.

### Step 2 — Plan the plugin

Before writing code, define:

- **Items**: What objects from this source appear in the list view? (e.g. channels, issues, orders)
- **Sub-items**: Do items contain child items? (e.g. messages within a channel, comments on an issue)
- **Field mapping**: For each API field, choose `type`, `listRole`, whether to badge, whether to filter
  - `listRole: "title"` → primary text in list item
  - `listRole: "subtitle"` → secondary line
  - `listRole: "timestamp"` → date shown in list
  - `listRole: "hidden"` → available in detail view only
- **Icon & emoji**: Choose a Lucide icon and emoji that matches the source (search lucide.dev)
- **Actions**: What mutations make sense? (archive, reply, mark-done, add-reaction)
- **Custom routes**: Does the plugin need endpoints beyond query/mutate? (attachment proxy, thread view, send endpoint)
- **Auth**: Is it per-user OAuth or workspace API key? Set `auth: { integrationId, scope }`
- **Env vars**: What environment variables are needed in `{workspace}/.env`?

Show the user the mapping plan and ask for confirmation before writing code.

### Step 3 — Generate TypeScript

Create `{workspace}/plugins/{id}/plugin.ts`:

```typescript
// From {workspace}/plugins/{id}/plugin.ts, go up to packages/, then into inbox/src/types/
import type { Plugin, PluginItem, PluginContext } from "../../../inbox/src/types/plugin.js"

// API helpers
async function apiRequest<T>(path: string, body = {}): Promise<T> {
  const token = process.env.EXAMPLE_API_TOKEN
  if (!token) throw new Error("EXAMPLE_API_TOKEN is not set")
  const res = await fetch(`https://api.example.com${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  return data as T
}

const plugin: Plugin = {
  id: "example",
  name: "Example",
  icon: "Box",
  emoji: "📦",
  auth: { integrationId: "example", scope: "workspace" },

  fieldSchema: [
    { id: "title", label: "Title", type: "text", listRole: "title" },
    { id: "status", label: "Status", type: "select",
      badge: { show: "always", variant: "outline" },
      filter: { filterable: true, filterOptions: ["open", "closed"] } },
    { id: "updatedAt", label: "Updated", type: "date", listRole: "timestamp" },
    { id: "body", label: "Body", type: "markdown", listRole: "hidden" },
  ],

  async query(filters, cursor) {
    // Incremental backfill: filters.since is an ISO timestamp from last run.
    // Use it to fetch only items modified after that time.
    // Strategy depends on the API:
    //   - Server-side: pass as query param (e.g. `modified_after`, `after:date`)
    //   - Client-side: fetch all, filter on updatedAt > since
    const params: Record<string, unknown> = { status: filters.status, cursor }
    if (filters.since) params.modified_after = filters.since

    const data = await apiRequest<{ items: any[]; next?: string }>("/items", params)
    return {
      items: data.items.map((i) => ({ id: i.id, ...i })),
      nextCursor: data.next,
    }
  },

  async getItem(id) {
    // Fetch full detail for a single item
    return apiRequest(`/items/${id}`)
  },

  async querySubItems(itemId, filters, cursor) {
    // Fetch child items (e.g. comments, messages)
    const data = await apiRequest<{ items: any[]; next?: string }>(
      `/items/${itemId}/comments`,
      { cursor }
    )
    return { items: data.items, nextCursor: data.next }
  },

  async mutate(id, action, payload) {
    switch (action) {
      case "archive":
        await apiRequest(`/items/${id}/archive`, {})
        break
      case "reply":
        const { text } = (payload ?? {}) as { text?: string }
        if (!text) throw new Error("reply requires { text }")
        await apiRequest(`/items/${id}/comments`, { text })
        break
    }
  },

  // Dynamic filter options (fetch from API)
  filterOptions: {
    status: async () => {
      const data = await apiRequest<{ statuses: string[] }>("/statuses")
      return data.statuses
    },
  },

  // Custom routes for operations beyond query/mutate
  routes(app, { getContext }) {
    app.post("/send", async (c) => {
      const { itemId, text } = await c.req.json()
      await apiRequest(`/items/${itemId}/comments`, { text })
      return c.json({ ok: true })
    })
  },
}

export default plugin
```

### Step 3.5 — Add a process skill (optional)

Create a `process-{source}` skill that handles items from this plugin:

```
{workspace}/plugins/{id}/skills/process-{source}/SKILL.md
```

The process skill defines how the agent should handle items from this source:
1. Query context (via context-manager)
2. Search for applicable workflows
3. Propose actions (draft, update, etc.)
4. Execute approved actions
5. Update context with findings

### Step 3.6 — Add itemToContext for context backfill (optional)

If this plugin's items should be indexed for context search, add `itemToContext`:

```typescript
itemToContext(item) {
  // Return markdown string for context index, or null to skip
  return `# ${item.title}\n\n${item.body || item.snippet || ""}`
},
```

The backfill system (`POST /api/backfill`) calls `query({ since: "<ISO timestamp>" })` then `itemToContext()` for each item, writing results to `context/{pluginId}/{itemId}.md`. The `since` filter ensures only modified items are re-indexed on subsequent runs. See the Plugin interface for details.

### Step 4 — Save and activate

1. Write the plugin to `{workspace}/plugins/{id}/plugin.ts`
2. Add required env vars to `{workspace}/.env` (append, don't overwrite)
3. The server watches the workspace plugins directory — changes are **hot-reloaded** automatically (no restart needed for plugin file changes)
4. Tell the user which env vars to fill in (if not already set)

> **Note**: The server watches `{workspace}/plugins/` and auto-reloads on `.ts`/`.js` file changes. A full server restart is only needed when adding new env vars to `.env`.

### Step 5 — Verify

After restart, check the plugin loaded:

```bash
curl -s http://localhost:3002/api/plugins | jq '.[].id'
```

The new plugin ID should appear in the list. Open the inbox to verify the sidebar shows the new source.

## Quick Reference

| Concept | File | Purpose |
|---------|------|---------|
| Plugin interface | `references/plugin-interface.md` | All types, methods, and fields |
| Worked example | `references/slack-plugin-example.md` | Annotated Slack plugin (400 lines) |
| Common patterns | `references/patterns.md` | Replies, session linking, custom routes, filters |
