# Common Plugin Patterns

## Sub-Items (e.g. messages within a channel)

**Required sub-item fields for MessageRow rendering:**
- `text` (not `body`) — message content (HTML or plain text)
- `ts` — Unix timestamp as string in seconds (e.g. `String(new Date(dt).getTime() / 1000)`)
- `userName` (not `senderName`) — display name
- `bodyType` — set to `"html"` for HTML content, omit for plain text
- `attachments` — optional array of `{ url, contentType, name, size }` (images render inline)

When items contain child items (Slack messages in a channel, GitHub comments on an issue), implement `querySubItems`:

```typescript
async querySubItems(parentId, filters, cursor) {
  const data = await api.getComments(parentId, { cursor, limit: 50 })
  return {
    items: data.comments.map((c) => ({
      id: c.id,
      text: c.body,
      userName: c.author.name,
      ts: String(new Date(c.created_at).getTime() / 1000),
    })),
    nextCursor: data.next_cursor,
  }
}
```

When `querySubItems` exists, the detail panel renders a scrollable message list (via `MessageRow` components) instead of the widget tree.

## Thread Replies / Send Messages

For plugins that need a "reply" action (Slack, email, support tickets), use a combination of `mutate()` and `routes()`:

```typescript
// In mutate() — called via POST /api/{id}/items/{channelId}/mutate
case "reply": {
  const { text, threadTs } = (payload ?? {}) as { text?: string; threadTs?: string }
  if (!text) throw new Error("reply requires { text }")
  await api.postMessage({ channel: channelId, text, thread_ts: threadTs })
  break
}

// In routes() — direct endpoint at POST /api/{id}/send
routes(app, { getContext }) {
  app.post("/send", async (c) => {
    const { channel, text, threadTs } = await c.req.json()
    if (!channel || !text) return c.json({ error: "channel and text required" }, 400)
    const result = await api.postMessage({ channel, text, thread_ts: threadTs })
    return c.json({ ok: true, ts: result.ts })
  })
}
```

The `mutate()` path is for the generic plugin UI (action buttons). The `routes()` path is for custom client components that need direct API access.

## Session Linking

Any plugin item can be linked to an agent session. The client's `SessionActionMenu` component handles this automatically — it just needs a `source` prop:

```typescript
// In a custom detail component:
<SessionActionMenu
  source={{
    type: "slack",               // Plugin ID
    id: channelId,               // Item ID
    title: channelName,          // Display title
    content: messageContext,      // Text injected into the session as context
  }}
  linkedSessionId={linkedSession?.id}
/>
```

The server stores `linked_source_type` and `linked_source_id` in the sessions table. Any plugin's items can participate — no plugin-specific code needed.

For the generic PluginView (no custom component), session linking works through the item's data fields — the `SessionActionMenu` is rendered automatically for plugins that declare a `getItem` method.

## Dynamic Filter Options

Static options are declared inline. For dynamic options (fetched from the API), use `filterOptions`:

```typescript
filterOptions: {
  status: async () => {
    const data = await api.getStatuses()
    return data.map((s) => s.name)  // Returns string[]
  },
  assignee: async () => {
    const data = await api.getMembers()
    return data.map((m) => m.name)
  },
}
```

The server exposes these at `GET /api/{id}/fields/{fieldId}/options`. The client fetches them when the filter dropdown opens.

## Custom Routes

For endpoints that don't fit the query/mutate pattern (binary file downloads, webhooks, search), use `routes()`:

```typescript
routes(app, { getContext }) {
  // Binary file proxy
  app.get("/files/:fileId", async (c) => {
    const ctx = getContext(c)  // PluginContext with user email + credential resolver
    const token = await ctx.getCredential("service")
    const data = await downloadFile(c.req.param("fileId"), token)
    c.header("Content-Type", data.mimeType)
    return c.body(data.buffer)
  })

  // Thread replies view
  app.get("/thread/:parentId", async (c) => {
    const replies = await api.getReplies(c.req.param("parentId"))
    return c.json({ items: replies })
  })
}
```

Routes are mounted at `/api/{pluginId}/` — e.g., `/api/slack/thread/C123/1234567890.123456`.

## Per-User OAuth

For services requiring per-user auth (Google, GitHub with user tokens), use `PluginContext`:

```typescript
auth: { integrationId: "google", scope: "user" },

async query(filters, cursor, ctx) {
  const token = await ctx?.getCredential("google")
  if (!token) throw new Error("Google account not connected")
  // Use token for API calls
}
```

The client shows a "Connect" prompt when `auth.scope === "user"` and no credential exists.

## Workspace API Key Auth

For services using a shared workspace key (Notion, Slack, Shopify), read from `process.env`:

```typescript
auth: { integrationId: "slack", scope: "workspace" },

async query(filters, cursor) {
  const token = process.env.SLACK_BOT_TOKEN
  if (!token) throw new Error("SLACK_BOT_TOKEN not set")
  // Use token for API calls
}
```

## Badge Color Functions

Customize badge colors with Tailwind CSS classes:

```typescript
badge: {
  show: "always",
  variant: "secondary",
  colorFn: (value) => {
    switch (value) {
      case "open": return "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300"
      case "closed": return "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300"
      default: return ""
    }
  }
}
```

## User/Mention Resolution

When an API returns user IDs in text content (e.g., Slack's `<@UID>` mentions), resolve them server-side before returning to the client:

```typescript
const userCache = new Map<string, { name: string; avatar?: string }>()

async function resolveUser(userId: string): Promise<{ name: string; avatar?: string }> {
  if (userCache.has(userId)) return userCache.get(userId)!
  const result = await api.getUser(userId)
  const resolved = { name: result.displayName, avatar: result.avatarUrl }
  userCache.set(userId, resolved)
  return resolved
}

async function resolveTextMentions(text: string): Promise<string> {
  const pattern = /<@([A-Z0-9]+)(?:\|([^>]+))?>/g
  const matches = [...text.matchAll(pattern)]
  if (matches.length === 0) return text
  const uniqueIds = [...new Set(matches.map((m) => m[1]))]
  const resolved = await Promise.all(uniqueIds.map(async (id) => [id, (await resolveUser(id)).name] as const))
  const nameMap = new Map(resolved)
  return text.replace(pattern, (_, uid, displayName) => `@${displayName || nameMap.get(uid) || uid}`)
}
```

Include `userName` and `userAvatar` on sub-item objects so the generic `MessageRow` component can render avatars.

## Badge Label Transform

Use `labelFn` to transform raw values into display labels. Return `""` to suppress the badge:

```typescript
badge: {
  show: "if-set",
  variant: "secondary",
  labelFn: (v) => v === "true" ? "unread" : "",  // Show "unread", hide when read
  colorFn: (v) => v === "true" ? "bg-chart-3/20 text-chart-3" : "",
}
```

## HTML Body Rendering

For items with HTML content (emails, rich text), use `type: "html"`:

```typescript
{ id: "body", label: "Body", type: "html", listRole: "hidden" }
```

The detail view renders HTML in a sanitized prose widget. For markdown content, use `type: "markdown"`.

## External URLs

Include an `externalUrl` field on items to get an "Open in {App}" link in the detail header:

```typescript
return {
  id: item.id,
  title: item.name,
  externalUrl: `https://app.example.com/items/${item.id}`,
}
```

The generic `PluginDetail` renders this as an external link icon in the header toolbar.

## Ticket / Support Plugin (e.g. Gorgias, Zendesk, Linear)

For services where the primary items are tickets/issues with threaded messages:

- **Items** = tickets (list view with status, assignee, channel badges + filters)
- **Sub-items** = messages within a ticket (via `querySubItems`)
- **Mutations** = reply, close, assign, tag, snooze
- **Auth** = workspace API key (domain + API key + email in `.env`)

### Field schema pattern

```typescript
fieldSchema: [
  { id: "subject", label: "Subject", type: "text", listRole: "title" },
  { id: "customerEmail", label: "Customer", type: "text", listRole: "subtitle" },
  { id: "lastMessageAt", label: "Updated", type: "date", listRole: "timestamp" },
  { id: "status", label: "Status", type: "select",
    filter: { filterable: true, filterOptions: ["open", "closed", "pending"] },
    badge: { show: "always", variant: "secondary",
      colorFn: (v) => {
        if (v === "open") return "bg-chart-2/20 text-chart-2"
        if (v === "closed") return "bg-muted/60 text-muted-foreground"
        if (v === "pending") return "bg-chart-4/20 text-chart-4"
        return ""
      },
    } },
  { id: "channel", label: "Channel", type: "select",
    filter: { filterable: true, filterOptions: ["email", "chat", "phone", "social"] },
    badge: { show: "always", variant: "outline" } },
  { id: "assignee", label: "Assignee", type: "text",
    filter: { filterable: true },
    badge: { show: "if-set", variant: "secondary" } },
  { id: "tags", label: "Tags", type: "multiselect", listRole: "hidden" },
]
```

### Sub-items pattern (messages in a ticket)

```typescript
async querySubItems(ticketId, filters, cursor, ctx) {
  const messages = await apiRequest<{ data: any[] }>(`/tickets/${ticketId}/messages`)
  return {
    items: messages.data.map((m) => ({
      id: String(m.id),
      // Use `text`, not `body` or `body_text` — MessageRow requires this field name
      text: m.body_html || m.body_text,
      // Use `bodyType: "html"` when content is HTML so MessageRow renders it correctly
      bodyType: m.body_html ? "html" : undefined,
      // Use `userName`, not `senderName` — MessageRow requires this field name
      userName: m.sender?.name || m.sender?.email,
      userAvatar: m.sender?.avatar,
      // `ts` must be seconds-since-epoch as a string
      ts: String(new Date(m.created_datetime).getTime() / 1000),
      isInternal: m.via === "internal-note",
      // Attachments: images render as thumbnails, others as download links
      attachments: (m.attachments ?? []).map((a: any) => ({
        url: decodeURIComponent(a.url),
        contentType: a.content_type,
        name: a.name,
        size: a.size,
      })),
    })),
  }
}
```

Include `userName` and `userAvatar` on each sub-item so the generic `MessageRow` renders avatars and names. The `ts` field must be a Unix timestamp string (seconds) for consistent formatting. Note that some CDN attachment URLs may be URL-encoded — always call `decodeURIComponent()` on them.

### Mutation pattern (reply + close)

```typescript
async mutate(id, action, payload) {
  switch (action) {
    case "reply": {
      const { text, isInternal } = (payload ?? {}) as { text?: string; isInternal?: boolean }
      if (!text) throw new Error("reply requires { text }")
      await apiRequest(`/tickets/${id}/messages`, {
        method: "POST",
        body: { channel: "internal-note", body_html: `<p>${text}</p>` },
      })
      break
    }
    case "close":
      await apiRequest(`/tickets/${id}`, { method: "PATCH", body: { status: "closed" } })
      break
    case "assign": {
      const { userId } = (payload ?? {}) as { userId?: number }
      await apiRequest(`/tickets/${id}`, { method: "PATCH", body: { assignee_user: { id: userId } } })
      break
    }
  }
}
```

## Timestamps

The frontend's `getItemTimestamp()` treats any string containing `.` as a Slack-style epoch float. This means ISO dates with fractional seconds (e.g. `2024-01-15T10:30:00.000000+00:00`) will be misinterpreted.

- For item-level timestamp fields (e.g. `lastMessageAt`), strip fractional seconds: `createdAt: apiDate.replace(/\.\d+/, "")`
- For sub-item `ts` fields, always convert to seconds-since-epoch: `ts: String(new Date(apiDate).getTime() / 1000)`

```typescript
// Item-level date — strip fractional seconds so it isn't treated as an epoch float
lastMessageAt: ticket.updated_at.replace(/\.\d+/, ""),

// Sub-item ts — always convert to seconds-since-epoch string
ts: String(new Date(message.created_datetime).getTime() / 1000),
```

## Client-Side Filtering

When the external API doesn't support a filter as a query parameter, fetch unfiltered and filter client-side. Always test which query params the API actually accepts with curl before hardcoding server-side filter params — many APIs silently ignore unknown params rather than returning an error.

```typescript
async query(filters, cursor) {
  // Parse comma-separated filter values
  const requestedViews = filters.view ? String(filters.view).split(",") : []

  // Pass only params the API actually accepts
  const data = await apiRequest<{ data: any[] }>("/tickets", {
    status: filters.status,   // supported
    // view: filters.view     // NOT supported — filter client-side instead
    cursor,
  })

  // Filter results after fetching
  const items = requestedViews.length
    ? data.data.filter((t) => requestedViews.includes(t.view))
    : data.data

  return { items: items.map(mapTicket) }
}
```

## Grouped Filter Options

For hierarchical categories (e.g. Gorgias views grouped by team, GitHub labels grouped by type), encode section headers as `__group__:SectionName` markers in the `filterOptions` response. Items before the first `__group__:` marker render ungrouped at the top. The frontend parses these into ComboboxGroup sections automatically.

```typescript
filterOptions: {
  view: async () => {
    const views = await apiRequest<{ data: any[] }>("/views")

    const options: string[] = []

    // Ungrouped items first (render at top without a section header)
    const shared = views.data.filter((v) => v.type === "shared")
    options.push(...shared.map((v) => v.name))

    // Group the rest by team
    const byTeam = Map.groupBy(views.data.filter((v) => v.type === "team"), (v) => v.team.name)
    for (const [teamName, teamViews] of byTeam) {
      options.push(`__group__:${teamName}`)
      options.push(...teamViews.map((v) => v.name))
    }

    return options
  },
}
```

## Attachments

Include attachments on sub-items for inline media rendering. Image attachments (where `contentType` starts with `"image/"`) render as thumbnails above the message text. Non-image attachments render as download links below the text.

```typescript
attachments: (m.attachments ?? []).map((a: any) => ({
  url: decodeURIComponent(a.url),   // Some APIs URL-encode CDN URLs — always decode
  contentType: a.content_type,
  name: a.name,
  size: a.size,                     // bytes, used for display formatting
})),
```

Notes:
- Some APIs URL-encode CDN URLs — always call `decodeURIComponent(a.url)` to be safe
- External CDN URLs (Instagram, Facebook, etc.) may carry time-limited signatures that expire after hours or days — they cannot be permanently stored and will break if cached

## Detail Schema (Action Buttons)

To add toolbar buttons to the detail panel, declare `detailSchema` with an `action-buttons` widget. Each action calls `mutate(itemId, mutation, undefined)` when clicked.

```typescript
detailSchema: [
  {
    id: "actions",
    type: "action-buttons",
    listRole: "hidden",
    actions: [
      {
        id: "archive",
        label: "Archive",
        icon: "Archive",
        mutation: "archive",
      },
      {
        id: "delete",
        label: "Delete",
        icon: "Trash2",
        mutation: "delete",
        variant: "destructive",
      },
    ],
  },
],

async mutate(id, action, payload) {
  switch (action) {
    case "archive":
      await apiRequest(`/items/${id}`, { method: "PATCH", body: { status: "archived" } })
      break
    case "delete":
      await apiRequest(`/items/${id}`, { method: "DELETE" })
      break
  }
},
```
