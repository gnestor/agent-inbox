# Slack Plugin — Annotated Example

This is a simplified version of the Slack plugin at `{workspace}/plugins/slack/plugin.ts`. It demonstrates all major plugin capabilities: list view, sub-items, mutations, custom routes, user resolution, and filtering.

## What It Does

- **List view**: Channels and DMs sorted by latest activity, with type/unread badges and filters
- **Detail view**: Messages in a channel (via `querySubItems`) with avatars, names, and thread counts
- **Thread replies**: Custom route to fetch and display thread replies
- **Send messages**: Custom route + mutation to post messages and thread replies
- **Reactions**: Add/remove emoji reactions via mutations
- **Mark read**: Mark a channel as read via mutation
- **Mention resolution**: `<@UID>` mentions in message text resolved to display names server-side

## Key Design Decisions

1. **`slackPost()` helper** — All Slack Web API methods use POST with JSON body. One helper handles auth, error checking, and response parsing.
2. **User cache with bulk preload** — On first query, `bulkLoadUsers()` fetches all workspace members via `users.list` (paginated). Subsequent `resolveUser()` calls hit the cache. Pending lookups are deduped via a Promise map to avoid N+1 races.
3. **Channel type mapping** — Plugin uses friendly names ("dm", "channel") while Slack API uses ("im", "public_channel"). A `typeMap` bridges them.
4. **Sub-items for messages** — `querySubItems(channelId)` returns messages. The generic PluginDetail renders these as `MessageRow` components with avatars.
5. **Server-side mention resolution** — `resolveTextMentions()` replaces `<@UID>` with `@DisplayName` before returning message text, so the client doesn't need Slack-specific logic.
6. **`labelFn` for boolean badges** — The `isUnread` badge uses `labelFn` to show "unread" instead of raw "true". Returns `""` to suppress the badge when read.
7. **External URLs** — Each channel includes an `externalUrl` linking to Slack's web client (requires `team_id` from `auth.test`).

## Source Code

```typescript
import type { Plugin, PluginItem, PluginContext } from "{inbox}/src/types/plugin.js"

const SLACK_BASE = "https://slack.com/api"

// ── API Helper ──────────────────────────────────────────────────────────────
// All Slack Web API methods use POST with JSON body and Bearer auth.

async function slackPost<T>(method: string, body: Record<string, unknown> = {}): Promise<T> {
  const token = process.env.SLACK_API_TOKEN ?? process.env.SLACK_BOT_TOKEN
  if (!token) throw new Error("SLACK_API_TOKEN is not set in workspace .env")
  const res = await fetch(`${SLACK_BASE}${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = (await res.json()) as { ok: boolean; error?: string } & T
  if (!data.ok) throw new Error(`Slack API error (${method}): ${data.error}`)
  return data
}

// ── User Resolution ─────────────────────────────────────────────────────────
// Bulk-loads all workspace members on first query, then resolves from cache.
// Pending lookups are deduped so concurrent resolves share one fetch.

const userCache = new Map<string, { name: string; avatar?: string }>()
const pendingLookups = new Map<string, Promise<{ name: string; avatar?: string }>>()
let bulkLoadPromise: Promise<void> | null = null

async function bulkLoadUsers(): Promise<void> {
  if (bulkLoadPromise) return bulkLoadPromise
  bulkLoadPromise = (async () => {
    let cursor: string | undefined
    do {
      const result = await slackPost<{ members: any[]; response_metadata?: { next_cursor?: string } }>(
        "/users.list", { limit: 200, ...(cursor ? { cursor } : {}) }
      )
      for (const u of result.members) {
        const name = u.profile?.display_name || u.profile?.real_name || u.name || u.id
        userCache.set(u.id, { name, avatar: u.profile?.image_48 })
      }
      cursor = result.response_metadata?.next_cursor || undefined
    } while (cursor)
  })()
  return bulkLoadPromise
}

async function resolveUser(userId: string): Promise<{ name: string; avatar?: string }> {
  await bulkLoadUsers()
  if (userCache.has(userId)) return userCache.get(userId)!
  if (pendingLookups.has(userId)) return pendingLookups.get(userId)!
  const lookup = (async () => {
    try {
      const result = await slackPost<{ user: any }>("/users.info", { user: userId })
      const name = result.user.profile?.display_name || result.user.profile?.real_name || result.user.name
      const resolved = { name, avatar: result.user.profile?.image_48 }
      userCache.set(userId, resolved)
      return resolved
    } catch {
      const fallback = { name: userId }
      userCache.set(userId, fallback)
      return fallback
    } finally {
      pendingLookups.delete(userId)
    }
  })()
  pendingLookups.set(userId, lookup)
  return lookup
}

// ── Mention Resolution ──────────────────────────────────────────────────────

async function resolveTextMentions(text: string): Promise<string> {
  const pattern = /<@([A-Z0-9]+)(?:\|([^>]+))?>/g
  const matches = [...text.matchAll(pattern)]
  if (matches.length === 0) return text
  const uniqueIds = [...new Set(matches.map((m) => m[1]))]
  const resolved = await Promise.all(uniqueIds.map(async (id) => [id, (await resolveUser(id)).name] as const))
  const nameMap = new Map(resolved)
  return text.replace(pattern, (_, uid, displayName) => `@${displayName || nameMap.get(uid) || uid}`)
}

// ── Item Mapping ────────────────────────────────────────────────────────────

async function toChannelItem(ch: any, team?: string): Promise<PluginItem> {
  const channelType = ch.is_im ? "dm" : ch.is_mpim ? "group_dm" : ch.is_private ? "private_channel" : "channel"
  let channelName = ch.name ?? ch.id
  if (ch.is_im && ch.user) channelName = (await resolveUser(ch.user)).name

  return {
    id: ch.id,
    channelName,
    channelType,
    isUnread: (ch.unread_count ?? 0) > 0,
    unreadCount: ch.unread_count ?? 0,
    memberCount: ch.num_members,
    topic: ch.topic?.value || undefined,
    purpose: ch.purpose?.value || undefined,
    latestTs: ch.latest?.ts,
    latestText: ch.latest?.text ? await resolveTextMentions(ch.latest.text) : undefined,
    externalUrl: team ? `https://app.slack.com/client/${team}/${ch.id}` : undefined,
  }
}

async function toMessageItem(msg: any): Promise<PluginItem> {
  const user = msg.user ? await resolveUser(msg.user) : undefined
  const text = await resolveTextMentions(msg.text)
  return {
    id: msg.ts, ts: msg.ts, text,
    userName: user?.name, userAvatar: user?.avatar, userId: msg.user,
    isBot: !!msg.bot_id,
    threadTs: msg.thread_ts,
    replyCount: msg.reply_count ?? 0,
  }
}

// ── Plugin Definition ───────────────────────────────────────────────────────

const slackPlugin: Plugin = {
  id: "slack",
  name: "Slack",
  icon: "MessageSquare",
  emoji: "💬",
  auth: { integrationId: "slack", scope: "workspace" },

  fieldSchema: [
    { id: "channelName", label: "Channel", type: "text", listRole: "title" },
    { id: "latestText", label: "Latest message", type: "text", listRole: "subtitle" },
    { id: "latestTs", label: "Last active", type: "date", listRole: "timestamp" },
    {
      id: "channelType", label: "Type", type: "select",
      filter: { filterable: true, filterOptions: ["channel", "private_channel", "dm", "group_dm"], filterType: "select" },
      badge: { show: "always", variant: "secondary",
        colorFn: (v) => {
          if (v === "dm") return "bg-chart-2/20 text-chart-2"
          if (v === "group_dm") return "bg-chart-4/20 text-chart-4"
          if (v === "private_channel") return "bg-muted/60 text-muted-foreground"
          return "bg-foreground/10 text-foreground"
        },
      },
    },
    {
      id: "isUnread", label: "Read status", type: "boolean",
      filter: { filterable: true, filterOptions: ["unread", "read"], filterType: "select" },
      badge: { show: "if-set", variant: "secondary",
        labelFn: (v) => v === "true" ? "unread" : "",
        colorFn: (v) => v === "true" ? "bg-chart-3/20 text-chart-3" : "" },
    },
    { id: "unreadCount", label: "Unread count", type: "number", badge: { show: "if-set", variant: "outline" } },
    { id: "memberCount", label: "Members", type: "number", listRole: "hidden" },
    { id: "topic", label: "Topic", type: "text", listRole: "hidden" },
    { id: "purpose", label: "Purpose", type: "text", listRole: "hidden" },
  ],

  async query(filters, cursor) {
    const team = await getTeamId()  // auth.test → team_id (cached)
    const typeMap: Record<string, string> = { channel: "public_channel", private_channel: "private_channel", dm: "im", group_dm: "mpim" }
    const typeFilter = filters["channelType"]
    const slackTypes = typeFilter
      ? typeFilter.split(",").map((t) => typeMap[t.trim()] ?? t.trim()).join(",")
      : "public_channel,private_channel,im,mpim"

    const result = await slackPost<{ channels: any[]; response_metadata?: { next_cursor?: string } }>(
      "/users.conversations", { types: slackTypes, limit: 100, exclude_archived: true, ...(cursor ? { cursor } : {}) }
    )

    let items = await Promise.all(result.channels.map((ch) => toChannelItem(ch, team)))
    const unreadFilter = filters["isUnread"]
    if (unreadFilter === "unread") items = items.filter((i) => i.isUnread)
    else if (unreadFilter === "read") items = items.filter((i) => !i.isUnread)
    items.sort((a, b) => parseFloat(b.latestTs as string ?? "0") - parseFloat(a.latestTs as string ?? "0"))

    return { items, nextCursor: result.response_metadata?.next_cursor || undefined }
  },

  async getItem(channelId) {
    const team = await getTeamId()
    const result = await slackPost<{ channel: any }>("/conversations.info", { channel: channelId, include_num_members: true })
    return toChannelItem(result.channel, team)
  },

  async querySubItems(channelId, _filters, cursor) {
    const result = await slackPost<{ messages: any[]; response_metadata?: { next_cursor?: string } }>(
      "/conversations.history", { channel: channelId, limit: 50, ...(cursor ? { cursor } : {}) }
    )
    const messages = result.messages.filter((m: any) => m.type === "message" && !m.subtype)
    return { items: await Promise.all(messages.map(toMessageItem)), nextCursor: result.response_metadata?.next_cursor || undefined }
  },

  async mutate(channelId, action, payload) {
    switch (action) {
      case "mark-read": {
        const history = await slackPost<{ messages: Array<{ ts: string }> }>("/conversations.history", { channel: channelId, limit: 1 })
        if (history.messages[0]?.ts) await slackPost("/conversations.mark", { channel: channelId, ts: history.messages[0].ts })
        break
      }
      case "reply": {
        const { text, threadTs } = (payload ?? {}) as { text?: string; threadTs?: string }
        if (!text) throw new Error("reply requires { text }")
        await slackPost("/chat.postMessage", { channel: channelId, text, ...(threadTs ? { thread_ts: threadTs } : {}) })
        break
      }
      case "add-reaction": {
        const { emoji, ts } = (payload ?? {}) as { emoji?: string; ts?: string }
        if (!emoji || !ts) throw new Error("add-reaction requires { emoji, ts }")
        await slackPost("/reactions.add", { channel: channelId, name: emoji, timestamp: ts })
        break
      }
      case "remove-reaction": {
        const { emoji, ts } = (payload ?? {}) as { emoji?: string; ts?: string }
        if (!emoji || !ts) throw new Error("remove-reaction requires { emoji, ts }")
        await slackPost("/reactions.remove", { channel: channelId, name: emoji, timestamp: ts })
        break
      }
    }
  },

  routes(app, { getContext }) {
    app.post("/send", async (c) => {
      const { channel, text, threadTs } = await c.req.json()
      if (!channel || !text) return c.json({ error: "channel and text are required" }, 400)
      const result = await slackPost("/chat.postMessage", { channel, text, ...(threadTs ? { thread_ts: threadTs } : {}) })
      return c.json({ ok: true, ts: (result as any).ts })
    })

    app.get("/thread/:channel/:ts", async (c) => {
      const { channel, ts } = c.req.param()
      const result = await slackPost<{ messages: any[] }>("/conversations.replies", { channel, ts, limit: 100 })
      const items = await Promise.all(result.messages.filter((m: any) => m.type === "message").map(toMessageItem))
      return c.json({ items })
    })

    app.get("/users", async (c) => {
      const result = await slackPost<{ members: any[] }>("/users.list", { limit: 200 })
      return c.json({
        users: result.members
          .filter((u: any) => !u.name.includes("bot") && u.id !== "USLACKBOT")
          .map((u: any) => ({ id: u.id, name: u.profile?.display_name || u.name, avatar: u.profile?.image_48 })),
      })
    })
  },
}

export default slackPlugin
```

## Env Vars Required

Add to `{workspace}/.env`:

```
SLACK_API_TOKEN=xoxp-...   # User token (preferred — has all scopes)
# or
SLACK_BOT_TOKEN=xoxb-...   # Bot token (standard operations only)
```

## What This Plugin Gets Automatically

Just by implementing the `Plugin` interface, the inbox gives you:
- Sidebar entry with 💬 emoji and "Slack" label
- Virtual-scrolled list view with channel type, read status, and unread count badges
- Filter popover with Type and Read status dropdowns
- Badge toggle menu (detail levels) for Type, Read status, and Unread count
- Message list detail view with avatars and resolved @mentions (via querySubItems)
- "Open in Slack" link in the detail header (via externalUrl field)
- Session linking — create agent sessions from any channel conversation
- REST API at `/api/slack/*` (items, sub-items, mutate, thread, send, users)
