# User Preferences

Persistent, per-user key/value storage for UI state. Preferences survive page reloads and are scoped to the signed-in Google account.

## Storage

SQLite table `user_preferences` — keyed by `(user_email, key)`:

```sql
CREATE TABLE user_preferences (
  user_email TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,   -- JSON-serialized
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_email, key)
);
```

Values are JSON-serialized on write and deserialized on read, so any JSON-compatible type works (strings, numbers, booleans, objects, arrays).

## Server API

All routes require an authenticated session cookie (`inbox_session`). The authenticated user's email is resolved from the cookie on every request — no user ID is passed explicitly.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/preferences` | Returns all preferences as `{ [key]: value }` |
| `PUT` | `/api/preferences` | Sets one preference: `{ key, value }` |
| `PUT` | `/api/preferences/batch` | Sets multiple: `{ prefs: { [key]: value } }` |

## Frontend Hook

```typescript
import { usePreference } from "@/hooks/use-preferences"

const [value, setValue] = usePreference("my.key", defaultValue)
```

- Returns `defaultValue` until the initial load resolves
- `setValue` updates the local cache immediately (optimistic) then persists to the server
- All hooks sharing the same key are notified synchronously when any one updates — no extra state needed for cross-component sync

The module-level cache means preferences are loaded once per page session and shared across all hook instances.

## Known Preferences

| Key | Type | Description |
|-----|------|-------------|
| `sessions.statusFilter` | `string[]` | Active status filters in session list |
| `sessions.projectFilter` | `string[]` | Active project filters in session list |
| `sessions.showFilters` | `boolean` | Whether the filter panel is open |
| `sessions.showStatus` | `boolean` | Show status badge in session list items |
| `sessions.showProject` | `boolean` | Show project badge in session list items |
| `sessions.transcript.visibility` | `TranscriptVisibility` | Which transcript block types to show |
| `session_prompt_templates` | `PromptTemplate[]` | Saved prompt templates for new sessions |

## Users

User records are upserted into the `users` table on every Google sign-in (see `server/lib/auth.ts`). The `user_preferences` table references users by email. Auth sessions (`auth_sessions`) are ephemeral and deleted on logout; the `users` table is the durable record.
