# Caching Architecture

The app uses a two-layer cache: server-side SQLite for Gmail incremental sync state, and client-side TanStack Query backed by IndexedDB for all API data.

## Client-Side (TanStack Query + IndexedDB)

All API data is cached in-memory by TanStack Query and persisted to IndexedDB via `idb-keyval`. The cache key is `INBOX_QUERY_CACHE`.

Set up in `src/main.tsx` via `PersistQueryClientProvider` + `createAsyncStoragePersister`.
QueryClient config is in `src/lib/queryClient.ts`.

### Query Keys

| Query Key | Hook / Component | Notes |
|---|---|---|
| `["emails", query]` | `useEmails` | `useInfiniteQuery` with `nextPageToken` |
| `["tasks", filters]` | `useTasks` | `useInfiniteQuery` with `nextCursor` |
| `["sessions", filters]` | `useSessions` | `useQuery` |
| `["session", id]` | `SessionView` | `useQuery` |
| `["task", id]` | `TaskDetail` | `useQuery` |
| `["thread", id]` | `useEmailThread` | `useQuery`; shared with `NewSessionPanel` |

### Caching Strategy

`staleTime: Infinity` globally — data never auto-refetches within a session. `gcTime: 24h` must exceed `staleTime` for the IndexedDB persister to store data between page loads.

`refetchOnWindowFocus: false` and `refetchOnMount: false` are set globally to prevent spurious refetches on tab switches or component remounts.

### Page-Load Refresh

On page load, `PersistQueryClientProvider` restores cached data from IndexedDB instantly (no loading spinner for returning users). The `onSuccess` callback then calls `queryClient.invalidateQueries()`, which marks all restored queries stale and triggers background refetches for any active subscribers. This ensures fresh data is fetched once per page load without blocking the initial render.

### Request Deduplication

If multiple components mount and request the same `queryKey`, TanStack deduplicates to a single in-flight request.

## Server-Side (SQLite `api_cache`)

Only one server-side cache remains — the Gmail incremental sync state. All other server caches were removed when TanStack Query was adopted.

### Gmail Incremental Sync (`gmail:sync:*`, 24h TTL)

The first-page email list request uses a sync protocol to avoid full Gmail API rescans:

1. **No sync state** → full fetch from Gmail API, save `historyId` + thread list
2. **Sync state exists** → call Gmail History API with saved `historyId`, get only changed thread IDs, fetch updated summaries, merge into cached thread list
3. **History gone (410)** → fall back to full fetch, reset sync state

This state must stay server-side because:
- Only the server has the OAuth credentials to call the Gmail API
- The `historyId` is a server-held cursor into Gmail's change log

### Session List Optimization

`listAllAgentSessions()` scans all `.jsonl` files in `~/.claude/projects/`. To avoid reading gigabytes of session data:
- Only the first 20 and last 10 lines of each file are read (via `fs.readSync` with byte offsets)
- Head lines provide `cwd` and `firstPrompt`; tail lines provide `summary`

## Navigation State (localStorage)

App navigation state is persisted to localStorage separately from API data — TanStack Query does not manage this.

Key: `spatial-nav-state` (`src/hooks/use-spatial-nav.tsx`). Persists:
- Current pathname (restored on app load via `getSavedPathname()`)
- Per-tab panel state (which item is selected on each tab)
- Per-item session state (which items had session panels open)
