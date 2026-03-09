# Caching Architecture

The app uses a two-layer cache: server-side SQLite for API call reduction, and client-side localStorage for instant UI rendering.

## Server-Side (SQLite `api_cache`)

Reduces external API calls to Gmail, Notion, and the filesystem.

| Cache Key Pattern | TTL | Purpose |
|---|---|---|
| `gmail:messages:*` | 5 min | Email list queries |
| `gmail:sync:*` | 24h | Gmail History API sync state (historyId + thread list) |
| `gmail:thread:*` | 5 min | Full thread detail |
| `gmail:message:*` | 5 min | Individual message |
| `gmail:labels` | 10 min | Label list |
| `sessions:agent-list` | 1 min | Agent SDK session scan (reads ~/.claude/projects/) |
| `sessions:transcript:*` | 5 min | Session JSONL transcript parse |
| `session:projects` | 5 min | Project name list |

### Gmail Incremental Sync

The first-page email list uses a sync protocol:
1. **Cache hit** → return immediately
2. **Incremental sync** → use saved `historyId` to fetch only changes via Gmail History API, merge into cached thread list
3. **Full sync** → fetch from scratch, save `historyId` for next sync

### Session List Optimization

`listAllAgentSessions()` scans all `.jsonl` files in `~/.claude/projects/`. To avoid reading 1.3GB+ of session data:
- Only the first 20 and last 10 lines of each file are read (using `fs.readSync` with byte offsets)
- Head lines provide `cwd` and `firstPrompt`; tail lines provide `summary` (result message)
- Result is cached for 1 minute via `staleWhileRevalidate`

## Client-Side (localStorage)

Provides instant rendering on page load / tab switch while fresh data loads in background.

### List Cache (`src/lib/list-cache.ts`)

Key prefix: `lc:`. Used by all data hooks.

| Key Pattern | Data |
|---|---|
| `lc:emails:{query}` | `{ messages, nextPageToken }` |
| `lc:tasks:{filterKey}` | `{ tasks, nextCursor }` |
| `lc:sessions:{filterKey}` | `Session[]` |
| `lc:session:{id}` | `{ session, messages }` |
| `lc:task:{id}` | `NotionTaskDetail` |

**Stale-while-revalidate pattern:**
1. On hook mount, read from `localStorage` → set as initial state (no loading spinner)
2. Fetch from API in parallel
3. When API responds, update state and overwrite cache

If localStorage is full, the oldest half of `lc:` entries are evicted.

### Navigation State (`src/hooks/use-spatial-nav.tsx`)

Key: `spatial-nav-state`. Persists:
- Current pathname (restored on app load via `getSavedPathname()`)
- Per-tab panel state (which item is selected on each tab)
- Per-item session state (which items had session panels open)

This ensures returning to the app shows the same panels the user left open.

### Refresh on Focus

All list hooks (`useEmails`, `useTasks`, `useSessions`) listen for `window.focus` events and refetch data when the user returns to the browser tab.
