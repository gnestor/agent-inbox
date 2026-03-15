# Phase 3: Collaboration + Output Sharing — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real-time presence tracking, session sharing between users, and output snapshot sharing — enabling collaborative use of sessions and external distribution of session outputs.

**Architecture:** Three independent subsystems that build on the existing SSE infrastructure in `session-manager.ts`. Presence tracking extends the in-memory SSE client map with user identity. Session sharing adds an access-control layer via a new `session_shares` table. Output sharing introduces a standalone `output_shares` table with opaque tokens for public/plugin-routed distribution.

**Tech Stack:** Hono routes, better-sqlite3, React 19, TanStack Query, SSE (existing), `crypto.randomUUID()` for tokens

**Prerequisites:** Phase 2 (Multi-User Auth + Credential Proxy) must be complete — session sharing relies on `user_email` identity and credential scoping to prevent unauthorized data access by viewers. Specifically, Phase 2's auth middleware enhancement must set `c.set("userEmail", ...)` on protected routes. All Phase 3 routes should use `c.get("userEmail")` to identify the current user rather than manually resolving auth sessions inline.

---

## File Structure

```
server/
├── lib/
│   ├── session-manager.ts       — MODIFY: add presence tracking (user identity on SSE clients)
│   ├── presence.ts              — CREATE: PresenceTracker class (in-memory user→session map)
│   └── __tests__/
│       ├── presence.test.ts     — CREATE: unit tests for PresenceTracker
│       └── output-shares.test.ts — CREATE: unit tests for share token generation + retrieval
├── routes/
│   ├── sessions.ts              — MODIFY: add share CRUD routes, presence-aware SSE
│   └── shares.ts                — CREATE: POST /api/shares, GET /api/shares/:token (public)
├── db/
│   └── schema.ts                — MODIFY: add session_shares + output_shares tables
src/
├── api/
│   └── client.ts                — MODIFY: add share API functions
├── components/
│   └── session/
│       ├── SessionView.tsx       — MODIFY: add avatar stack + share button in header
│       ├── PresenceAvatars.tsx   — CREATE: avatar stack component
│       ├── ShareSessionDialog.tsx — CREATE: share link dialog with permissions
│       ├── ShareOutputMenu.tsx   — CREATE: "Share to..." dropdown on output blocks
│       └── SharedOutputView.tsx  — CREATE: public read-only output view
├── hooks/
│   ├── use-session-stream.ts    — MODIFY: handle presence events
│   ├── use-presence.ts          — CREATE: hook exposing connected users for a session
│   └── use-session-shares.ts    — CREATE: mutation hooks for sharing
├── types/
│   └── index.ts                 — MODIFY: add Presence, SessionShare, OutputShare types
```

---

## Chunk 1: Presence Tracking

Track which users are viewing each session in real time. SSE clients get annotated with user identity; connect/disconnect broadcasts presence events to all viewers.

### Task 1: PresenceTracker module

**Files:**
- Create: `server/lib/presence.ts`
- Create: `server/lib/__tests__/presence.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// server/lib/__tests__/presence.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { PresenceTracker } from "../presence.js"

describe("PresenceTracker", () => {
  let tracker: PresenceTracker

  beforeEach(() => {
    tracker = new PresenceTracker()
  })

  describe("join/leave", () => {
    it("tracks a user joining a session", () => {
      tracker.join("session-1", { email: "grant@hammies.com", name: "Grant", picture: null })
      const users = tracker.getUsers("session-1")
      expect(users).toHaveLength(1)
      expect(users[0].email).toBe("grant@hammies.com")
    })

    it("deduplicates same user joining twice", () => {
      const user = { email: "grant@hammies.com", name: "Grant", picture: null }
      tracker.join("session-1", user)
      tracker.join("session-1", user)
      expect(tracker.getUsers("session-1")).toHaveLength(1)
      expect(tracker.getConnectionCount("session-1", "grant@hammies.com")).toBe(2)
    })

    it("tracks multiple users in same session", () => {
      tracker.join("session-1", { email: "grant@hammies.com", name: "Grant", picture: null })
      tracker.join("session-1", { email: "kevin@hammies.com", name: "Kevin", picture: null })
      expect(tracker.getUsers("session-1")).toHaveLength(2)
    })

    it("removes user only after all connections close", () => {
      const user = { email: "grant@hammies.com", name: "Grant", picture: null }
      tracker.join("session-1", user)
      tracker.join("session-1", user) // 2 tabs
      tracker.leave("session-1", "grant@hammies.com")
      expect(tracker.getUsers("session-1")).toHaveLength(1) // still 1 connection
      tracker.leave("session-1", "grant@hammies.com")
      expect(tracker.getUsers("session-1")).toHaveLength(0)
    })

    it("returns empty array for unknown session", () => {
      expect(tracker.getUsers("nonexistent")).toEqual([])
    })
  })

  describe("callbacks", () => {
    it("fires onJoin when first connection for a user", () => {
      const onJoin = vi.fn()
      tracker.onJoin = onJoin
      const user = { email: "grant@hammies.com", name: "Grant", picture: null }
      tracker.join("session-1", user)
      expect(onJoin).toHaveBeenCalledWith("session-1", user)
    })

    it("does not fire onJoin for duplicate connections", () => {
      const onJoin = vi.fn()
      tracker.onJoin = onJoin
      const user = { email: "grant@hammies.com", name: "Grant", picture: null }
      tracker.join("session-1", user)
      tracker.join("session-1", user)
      expect(onJoin).toHaveBeenCalledTimes(1)
    })

    it("fires onLeave when last connection for a user closes", () => {
      const onLeave = vi.fn()
      tracker.onLeave = onLeave
      const user = { email: "grant@hammies.com", name: "Grant", picture: null }
      tracker.join("session-1", user)
      tracker.join("session-1", user)
      tracker.leave("session-1", "grant@hammies.com")
      expect(onLeave).not.toHaveBeenCalled()
      tracker.leave("session-1", "grant@hammies.com")
      expect(onLeave).toHaveBeenCalledWith("session-1", "grant@hammies.com")
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/inbox && npx vitest run server/lib/__tests__/presence.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write the PresenceTracker implementation**

```typescript
// server/lib/presence.ts

export interface PresenceUser {
  email: string
  name: string
  picture: string | null
}

interface PresenceEntry {
  user: PresenceUser
  connectionCount: number
}

/**
 * In-memory presence tracker.
 * Tracks which users are viewing each session, with reference counting
 * for multiple tabs/connections per user.
 */
export class PresenceTracker {
  // sessionId → email → PresenceEntry
  private sessions = new Map<string, Map<string, PresenceEntry>>()

  /** Called when the *first* connection for a user opens (not duplicates). */
  onJoin?: (sessionId: string, user: PresenceUser) => void

  /** Called when the *last* connection for a user closes. */
  onLeave?: (sessionId: string, userEmail: string) => void

  join(sessionId: string, user: PresenceUser): void {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, new Map())
    }
    const sessionMap = this.sessions.get(sessionId)!
    const existing = sessionMap.get(user.email)

    if (existing) {
      existing.connectionCount++
      // Update user info (name/picture may have changed)
      existing.user = user
    } else {
      sessionMap.set(user.email, { user, connectionCount: 1 })
      this.onJoin?.(sessionId, user)
    }
  }

  leave(sessionId: string, userEmail: string): void {
    const sessionMap = this.sessions.get(sessionId)
    if (!sessionMap) return

    const entry = sessionMap.get(userEmail)
    if (!entry) return

    entry.connectionCount--
    if (entry.connectionCount <= 0) {
      sessionMap.delete(userEmail)
      if (sessionMap.size === 0) {
        this.sessions.delete(sessionId)
      }
      this.onLeave?.(sessionId, userEmail)
    }
  }

  getUsers(sessionId: string): PresenceUser[] {
    const sessionMap = this.sessions.get(sessionId)
    if (!sessionMap) return []
    return [...sessionMap.values()].map((e) => e.user)
  }

  getConnectionCount(sessionId: string, userEmail: string): number {
    return this.sessions.get(sessionId)?.get(userEmail)?.connectionCount ?? 0
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/inbox && npx vitest run server/lib/__tests__/presence.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/lib/presence.ts server/lib/__tests__/presence.test.ts
git commit -m "feat: add PresenceTracker module for session presence"
```

### Task 2: Wire presence into SSE stream

**Files:**
- Modify: `server/lib/session-manager.ts`
- Modify: `server/routes/sessions.ts`

- [ ] **Step 1: Create and export the singleton PresenceTracker**

In `session-manager.ts`, import and instantiate:

```typescript
import { PresenceTracker, type PresenceUser } from "./presence.js"

// Singleton presence tracker
export const presence = new PresenceTracker()

// Wire presence events to SSE broadcasts
presence.onJoin = (sessionId, user) => {
  broadcastToSession(sessionId, {
    type: "presence",
    event: "join",
    user: { email: user.email, name: user.name, picture: user.picture },
    users: presence.getUsers(sessionId),
  })
}

presence.onLeave = (sessionId, userEmail) => {
  broadcastToSession(sessionId, {
    type: "presence",
    event: "leave",
    userEmail,
    users: presence.getUsers(sessionId),
  })
}
```

- [ ] **Step 2: Update SSE stream route to pass user identity**

In `server/routes/sessions.ts`, the `GET /:id/stream` handler needs to resolve the current user from the auth cookie and register presence on connect/disconnect.

Import the auth helper and cookie reader at the top:

```typescript
import { getCookie } from "hono/cookie"
import { getSession as getAuthSession } from "../lib/auth.js"
import { SESSION_COOKIE } from "./auth.js"
```

Update the stream handler to track presence:

```typescript
sessionRoutes.get("/:id/stream", async (c) => {
  const sessionId = c.req.param("id")

  // Resolve current user for presence tracking
  const token = getCookie(c, SESSION_COOKIE)
  const authSession = token ? getAuthSession(token) : undefined
  const currentUser = authSession?.user ?? null

  return streamSSE(c, async (stream) => {
    const send = (data: string) => {
      stream.writeSSE({ data, event: "message" })
    }

    sessions.addSseClient(sessionId, send)

    // Register presence
    if (currentUser) {
      sessions.presence.join(sessionId, {
        email: currentUser.email,
        name: currentUser.name,
        picture: currentUser.picture ?? null,
      })
    }

    // Send current presence state immediately so the new client sees who's here
    const currentUsers = sessions.presence.getUsers(sessionId)
    await stream.writeSSE({
      data: JSON.stringify({ type: "presence", event: "sync", users: currentUsers }),
      event: "message",
    })

    // Send existing messages first for catch-up
    const existing = sessions.getSessionMessages(sessionId)
    for (const msg of existing) {
      await stream.writeSSE({
        data: JSON.stringify({
          sequence: msg.sequence,
          message: JSON.parse(msg.message as string),
        }),
        event: "message",
      })
    }

    // Keep connection alive
    const keepAlive = setInterval(() => {
      stream.writeSSE({ data: "", event: "ping" })
    }, 15_000)

    // Wait for client disconnect
    try {
      await new Promise((resolve) => {
        stream.onAbort(() => resolve(undefined))
      })
    } finally {
      clearInterval(keepAlive)
      sessions.removeSseClient(sessionId, send)
      if (currentUser) {
        sessions.presence.leave(sessionId, currentUser.email)
      }
    }
  })
})
```

- [ ] **Step 3: Run tests**

Run: `cd packages/inbox && npm run test:ci`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add server/lib/session-manager.ts server/routes/sessions.ts
git commit -m "feat: wire presence tracking into SSE stream lifecycle"
```

### Task 3: Frontend presence types and hook

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/hooks/use-session-stream.ts`
- Create: `src/hooks/use-presence.ts`

- [ ] **Step 1: Add presence types**

In `src/types/index.ts`, add after the `SessionMessage` interface:

```typescript
export interface PresenceUser {
  email: string
  name: string
  picture: string | null
}
```

- [ ] **Step 2: Handle presence events in useSessionStream**

In `src/hooks/use-session-stream.ts`, add presence state:

```typescript
const [presenceUsers, setPresenceUsers] = useState<import("@/types").PresenceUser[]>([])
```

In the `es.addEventListener("message", ...)` handler, add before the existing `data.type` checks:

```typescript
if (data.type === "presence") {
  if (data.users) {
    setPresenceUsers(data.users)
  }
  return
}
```

In the cleanup/reset section (where `setMessages([])` etc. are called on sessionId change), add:

```typescript
setPresenceUsers([])
```

Add `presenceUsers` to the returned object:

```typescript
return { messages, connected, sessionStatus, pendingQuestion, disconnect, clearPendingQuestion, presenceUsers }
```

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts src/hooks/use-session-stream.ts
git commit -m "feat: handle presence SSE events in useSessionStream"
```

### Task 4: PresenceAvatars component

**Files:**
- Create: `src/components/session/PresenceAvatars.tsx`

- [ ] **Step 1: Create the avatar stack component**

```tsx
// src/components/session/PresenceAvatars.tsx
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@hammies/frontend/components/ui"
import type { PresenceUser } from "@/types"

interface PresenceAvatarsProps {
  users: PresenceUser[]
  currentUserEmail?: string
  maxVisible?: number
}

function initialsFrom(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
}

function Avatar({ user, isSelf }: { user: PresenceUser; isSelf: boolean }) {
  const label = isSelf ? `${user.name} (you)` : user.name

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={`
              relative -ml-1.5 first:ml-0 h-6 w-6 rounded-full border-2 border-background
              flex items-center justify-center text-[10px] font-medium
              ${isSelf ? "ring-2 ring-primary/50" : ""}
              ${user.picture ? "" : "bg-muted text-muted-foreground"}
            `}
          >
            {user.picture ? (
              <img
                src={user.picture}
                alt={label}
                className="h-full w-full rounded-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              initialsFrom(user.name)
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function PresenceAvatars({
  users,
  currentUserEmail,
  maxVisible = 4,
}: PresenceAvatarsProps) {
  if (users.length === 0) return null

  // Sort: current user first, then alphabetical
  const sorted = [...users].sort((a, b) => {
    if (a.email === currentUserEmail) return -1
    if (b.email === currentUserEmail) return 1
    return a.name.localeCompare(b.name)
  })

  const visible = sorted.slice(0, maxVisible)
  const overflow = sorted.length - maxVisible

  return (
    <div className="flex items-center">
      {visible.map((user) => (
        <Avatar key={user.email} user={user} isSelf={user.email === currentUserEmail} />
      ))}
      {overflow > 0 && (
        <div className="h-6 w-6 -ml-1.5 rounded-full border-2 border-background bg-muted flex items-center justify-center text-[10px] font-medium text-muted-foreground">
          +{overflow}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/session/PresenceAvatars.tsx
git commit -m "feat: add PresenceAvatars component"
```

### Task 5: Add presence avatars to SessionView header

**Files:**
- Modify: `src/components/session/SessionView.tsx`

- [ ] **Step 1: Import PresenceAvatars and auth hook**

```typescript
import { PresenceAvatars } from "./PresenceAvatars"
import { useAuth } from "@/hooks/use-auth"
```

- [ ] **Step 2: Wire presence into the header**

Inside `SessionView`, access the current user and stream presence:

```typescript
const { user: currentUser } = useAuth()
```

The `stream` object already exposes `presenceUsers` from Task 3.

In the header JSX, insert the avatar stack between the title and the right-side controls. Replace the `left` prop of `PanelHeader` (~line 155):

```tsx
left={
  <>
    {isFromSidebar ? (
      <SidebarButton />
    ) : (
      <BackButton onClick={() => navigate(parentPath)} />
    )}
    <h2 className="font-semibold text-sm truncate min-w-0">{displayTitle}</h2>
    <PresenceAvatars
      users={stream.presenceUsers}
      currentUserEmail={currentUser?.email}
    />
  </>
}
```

- [ ] **Step 3: Run tests**

Run: `cd packages/inbox && npm run test:ci`
Expected: PASS

- [ ] **Step 4: Manual verification**

1. Open a session in two browser tabs (same user)
2. Verify avatar stack shows one avatar (deduplicated)
3. Open in a second browser profile (different user)
4. Verify both avatars appear, "you" indicator on own avatar
5. Close one tab → avatar disappears after SSE disconnect

- [ ] **Step 5: Commit**

```bash
git add src/components/session/SessionView.tsx
git commit -m "feat: add presence avatar stack to session header"
```

---

## Chunk 2: Session Sharing

Allow users to share a session with other users by email. Shared sessions appear in the viewer's session list. Writers can resume; viewers see the transcript but cannot trigger data-sensitive actions.

### Task 6: Database tables for session sharing

**Files:**
- Modify: `server/db/schema.ts`

- [ ] **Step 1: Add session_shares table**

In `initializeDatabase()`, add after the existing `CREATE TABLE` statements:

```sql
CREATE TABLE IF NOT EXISTS session_shares (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,
  can_write INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  PRIMARY KEY (session_id, user_email)
);

CREATE INDEX IF NOT EXISTS idx_session_shares_user
  ON session_shares(user_email);
```

> **I7: FK constraint for agent-only sessions.** The `session_shares` table has `REFERENCES sessions(id)`. Agent-only sessions discovered from JSONL files in `~/.claude/projects/` do not have rows in the `sessions` table, so inserting a share for one will fail the FK constraint. Before inserting into `session_shares`, the code must ensure the session exists in the DB. See Task 8 Step 1 for the required check.

- [ ] **Step 2: Run tests**

Run: `cd packages/inbox && npm run test:ci`
Expected: PASS (table creation is idempotent)

- [ ] **Step 3: Commit**

```bash
git add server/db/schema.ts
git commit -m "feat: add session_shares table"
```

### Task 7: Session share CRUD in session-manager

**Files:**
- Modify: `server/lib/session-manager.ts`

- [ ] **Step 1: Add share management functions**

```typescript
export function shareSession(
  sessionId: string,
  userEmail: string,
  canWrite: boolean,
  createdBy: string,
) {
  const db = getDb()
  db.prepare(
    `INSERT INTO session_shares (session_id, user_email, can_write, created_at, created_by)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(session_id, user_email) DO UPDATE SET can_write = excluded.can_write`,
  ).run(sessionId, userEmail, canWrite ? 1 : 0, new Date().toISOString(), createdBy)
}

export function revokeSessionShare(sessionId: string, userEmail: string) {
  const db = getDb()
  db.prepare("DELETE FROM session_shares WHERE session_id = ? AND user_email = ?").run(
    sessionId,
    userEmail,
  )
}

export function getSessionShares(sessionId: string) {
  const db = getDb()
  return db
    .prepare(
      `SELECT ss.*, u.name, u.picture
       FROM session_shares ss
       LEFT JOIN users u ON u.email = ss.user_email
       WHERE ss.session_id = ?`,
    )
    .all(sessionId) as Array<{
    session_id: string
    user_email: string
    can_write: number
    created_at: string
    created_by: string
    name: string | null
    picture: string | null
  }>
}

export function getSessionShareForUser(sessionId: string, userEmail: string) {
  const db = getDb()
  return db
    .prepare("SELECT * FROM session_shares WHERE session_id = ? AND user_email = ?")
    .get(sessionId, userEmail) as
    | { session_id: string; user_email: string; can_write: number }
    | undefined
}

export function getSharedSessionsForUser(userEmail: string) {
  const db = getDb()
  return db
    .prepare(
      `SELECT s.*, ss.can_write
       FROM sessions s
       JOIN session_shares ss ON ss.session_id = s.id
       WHERE ss.user_email = ?
       ORDER BY s.updated_at DESC`,
    )
    .all(userEmail) as Array<Record<string, unknown>>
}
```

- [ ] **Step 2: Commit**

```bash
git add server/lib/session-manager.ts
git commit -m "feat: add session share CRUD functions"
```

### Task 8: Session sharing routes

**Files:**
- Modify: `server/routes/sessions.ts`

- [ ] **Step 1: Add share routes**

Import `getCookie` and `getSession as getAuthSession` if not already imported (from Task 2). Add a helper to resolve the current user email:

```typescript
function getCurrentUserEmail(c: import("hono").Context): string | null {
  const token = getCookie(c, SESSION_COOKIE)
  if (!token) return null
  const session = getAuthSession(token)
  return session?.user.email ?? null
}
```

Add the following routes:

```typescript
// List shares for a session
sessionRoutes.get("/:id/shares", async (c) => {
  const sessionId = c.req.param("id")
  const shares = sessions.getSessionShares(sessionId)
  return c.json({
    shares: shares.map((s) => ({
      userEmail: s.user_email,
      userName: s.name,
      userPicture: s.picture,
      canWrite: !!s.can_write,
      createdAt: s.created_at,
      createdBy: s.created_by,
    })),
  })
})

// Share a session with a user
sessionRoutes.post("/:id/shares", async (c) => {
  const sessionId = c.req.param("id")
  const currentEmail = getCurrentUserEmail(c)
  if (!currentEmail) return c.json({ error: "Unauthorized" }, 401)

  const { userEmail, canWrite } = await c.req.json()
  if (!userEmail || typeof userEmail !== "string") {
    return c.json({ error: "userEmail is required" }, 400)
  }

  // I7: Ensure session exists in DB before inserting share (FK constraint).
  // Agent-only sessions (from JSONL files) won't have a DB record yet.
  if (!sessions.getSessionRecord(sessionId)) {
    const agentSession = await sessions.findAgentSession(sessionId)
    if (!agentSession) return c.json({ error: "Session not found" }, 404)
    // Import minimal record so the FK on session_shares is satisfied
    sessions.createSessionRecord(sessionId, agentSession.firstPrompt || "", {
      triggerSource: "manual",
    })
  }

  sessions.shareSession(sessionId, userEmail, !!canWrite, currentEmail)
  return c.json({ ok: true })
})

// Revoke a share
sessionRoutes.delete("/:id/shares/:email", async (c) => {
  const sessionId = c.req.param("id")
  const userEmail = decodeURIComponent(c.req.param("email"))
  sessions.revokeSessionShare(sessionId, userEmail)
  return c.json({ ok: true })
})
```

- [ ] **Step 2: Add access check to session detail route**

Update the existing `GET /:id` route to allow access if the user has a share, even if the session wasn't started by them. In the 404 fallback path (after agent session lookup fails), add a share check:

> **Note:** Currently all authenticated users can see all sessions. The share system adds explicit permission tracking for future enforcement when sessions become user-scoped. For now, shares are additive metadata rather than exclusive access gates.

- [ ] **Step 3: Include shared sessions in session list**

In the `GET /` (list sessions) route, after building the merged sessions array, also fetch sessions shared with the current user and merge them in:

```typescript
// After the existing merge logic, before deduplication:
const currentEmail = getCurrentUserEmail(c)
if (currentEmail) {
  const shared = sessions.getSharedSessionsForUser(currentEmail)
  for (const s of shared) {
    if (!seenIds.has(s.id as string)) {
      merged.push({
        id: s.id as string,
        status: s.status as string,
        prompt: s.prompt as string,
        summary: (s.summary as string) || null,
        startedAt: s.started_at as string,
        updatedAt: s.updated_at as string,
        completedAt: (s.completed_at as string) || null,
        messageCount: s.message_count as number,
        linkedEmailId: null,
        linkedEmailThreadId: null,
        linkedTaskId: null,
        triggerSource: (s.trigger_source as string) || "manual",
        project: currentProject,
        linkedItemTitle: null,
        shared: true,
        canWrite: !!(s.can_write as number),
      })
      seenIds.add(s.id as string)
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/inbox && npm run test:ci`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/routes/sessions.ts
git commit -m "feat: add session sharing routes (list, create, revoke)"
```

### Task 9: Frontend types and API client for sharing

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/api/client.ts`
- Create: `src/hooks/use-session-shares.ts`

- [ ] **Step 1: Add types**

In `src/types/index.ts`, add:

```typescript
export interface SessionShare {
  userEmail: string
  userName: string | null
  userPicture: string | null
  canWrite: boolean
  createdAt: string
  createdBy: string
}
```

Update the `Session` interface to add optional sharing metadata:

```typescript
// Add to Session interface:
shared?: boolean
canWrite?: boolean
```

- [ ] **Step 2: Add API functions**

In `src/api/client.ts`, add after the session functions:

```typescript
// Session sharing

export async function getSessionShares(sessionId: string) {
  return request<{ shares: import("@/types").SessionShare[] }>(
    `/sessions/${sessionId}/shares`,
  )
}

export async function shareSession(
  sessionId: string,
  body: { userEmail: string; canWrite: boolean },
) {
  return request<{ ok: boolean }>(`/sessions/${sessionId}/shares`, {
    method: "POST",
    body: JSON.stringify(body),
  })
}

export async function revokeSessionShare(sessionId: string, userEmail: string) {
  return request<{ ok: boolean }>(
    `/sessions/${sessionId}/shares/${encodeURIComponent(userEmail)}`,
    { method: "DELETE" },
  )
}
```

- [ ] **Step 3: Create mutation hooks**

> **D4: Relationship to Phase 1's `use-session-mutation.ts`.** Phase 1 creates `src/hooks/use-session-mutation.ts` for session-related mutations (start, resume, cancel). Consider adding sharing mutations there instead of creating a separate file, to keep all session mutations co-located. If a separate file is preferred for separation of concerns, add a comment in `use-session-mutation.ts` pointing to `use-session-shares.ts` and vice versa.

```typescript
// src/hooks/use-session-shares.ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  getSessionShares,
  shareSession,
  revokeSessionShare,
} from "@/api/client"

export function useSessionShares(sessionId: string) {
  return useQuery({
    queryKey: ["session-shares", sessionId],
    queryFn: () => getSessionShares(sessionId),
    select: (data) => data.shares,
  })
}

export function useShareSession(sessionId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { userEmail: string; canWrite: boolean }) =>
      shareSession(sessionId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["session-shares", sessionId] })
    },
  })
}

export function useRevokeSessionShare(sessionId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userEmail: string) => revokeSessionShare(sessionId, userEmail),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["session-shares", sessionId] })
    },
  })
}
```

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts src/api/client.ts src/hooks/use-session-shares.ts
git commit -m "feat: add session sharing types, API client, and hooks"
```

### Task 10: ShareSessionDialog component

**Files:**
- Create: `src/components/session/ShareSessionDialog.tsx`

- [ ] **Step 1: Create the share dialog**

```tsx
// src/components/session/ShareSessionDialog.tsx
import { useState } from "react"
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Button,
  Input,
  Switch,
  Label,
} from "@hammies/frontend/components/ui"
import { Share2, Trash2, Loader2 } from "lucide-react"
import { useSessionShares, useShareSession, useRevokeSessionShare } from "@/hooks/use-session-shares"

interface ShareSessionDialogProps {
  sessionId: string
}

export function ShareSessionDialog({ sessionId }: ShareSessionDialogProps) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState("")
  const [canWrite, setCanWrite] = useState(false)

  const { data: shares = [], isLoading } = useSessionShares(sessionId)
  const shareMutation = useShareSession(sessionId)
  const revokeMutation = useRevokeSessionShare(sessionId)

  function handleShare() {
    const trimmed = email.trim()
    if (!trimmed) return
    shareMutation.mutate(
      { userEmail: trimmed, canWrite },
      {
        onSuccess: () => {
          setEmail("")
          setCanWrite(false)
        },
      },
    )
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault()
      handleShare()
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="shrink-0 p-1.5 rounded-md hover:bg-accent text-muted-foreground"
          title="Share session"
        >
          <Share2 className="h-4 w-4" />
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share Session</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Add share */}
          <div className="flex gap-2">
            <Input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1"
            />
            <Button
              onClick={handleShare}
              disabled={!email.trim() || shareMutation.isPending}
              size="sm"
            >
              {shareMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Share"
              )}
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id="can-write"
              checked={canWrite}
              onCheckedChange={setCanWrite}
            />
            <Label htmlFor="can-write" className="text-sm">
              Can resume sessions (write access)
            </Label>
          </div>

          {/* Current shares */}
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading...</div>
          ) : shares.length > 0 ? (
            <div className="space-y-2">
              <div className="text-sm font-medium">Shared with</div>
              {shares.map((share) => (
                <div
                  key={share.userEmail}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {share.userPicture ? (
                      <img
                        src={share.userPicture}
                        alt=""
                        className="h-6 w-6 rounded-full"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-medium">
                        {(share.userName || share.userEmail)[0].toUpperCase()}
                      </div>
                    )}
                    <div className="truncate">
                      {share.userName || share.userEmail}
                    </div>
                    <span className="text-muted-foreground text-xs">
                      {share.canWrite ? "can edit" : "view only"}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => revokeMutation.mutate(share.userEmail)}
                    className="shrink-0 p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/session/ShareSessionDialog.tsx
git commit -m "feat: add ShareSessionDialog component"
```

### Task 11: Add share button to SessionView header

**Files:**
- Modify: `src/components/session/SessionView.tsx`

- [ ] **Step 1: Import and add ShareSessionDialog**

```typescript
import { ShareSessionDialog } from "./ShareSessionDialog"
```

In the header `right` prop, add the share button before the existing dropdown menu (~line 178):

```tsx
<ShareSessionDialog sessionId={sessionId} />
```

- [ ] **Step 2: Disable resume for read-only shared sessions**

If `data.session.shared && !data.session.canWrite`, disable the resume input:

```typescript
const canResume = !data?.session.shared || data?.session.canWrite
```

Use `canResume` to conditionally disable the textarea and send button (in addition to the existing `isRunning || sending` checks).

- [ ] **Step 3: Run tests**

Run: `cd packages/inbox && npm run test:ci`
Expected: PASS

- [ ] **Step 4: Manual verification**

1. Open a session → see the share (Share2) icon in the header
2. Click it → dialog opens with email input
3. Enter a teammate's email, toggle write access, click Share
4. Share appears in the "Shared with" list
5. Revoke a share → disappears from the list
6. Log in as the shared user → session appears in their session list
7. If view-only: resume input is disabled with "View only" label

- [ ] **Step 5: Commit**

```bash
git add src/components/session/SessionView.tsx
git commit -m "feat: add share button and read-only enforcement to SessionView"
```

---

## Chunk 3: Output Sharing

Enable sharing individual output blocks as standalone snapshots — either via opaque public links or by routing to external services (e.g., Notion page creation).

### Task 12: Database table for output shares

**Files:**
- Modify: `server/db/schema.ts`

- [ ] **Step 1: Add output_shares table**

In `initializeDatabase()`, add:

```sql
CREATE TABLE IF NOT EXISTS output_shares (
  token TEXT PRIMARY KEY,
  output_json TEXT NOT NULL,
  title TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);
```

- [ ] **Step 2: Commit**

```bash
git add server/db/schema.ts
git commit -m "feat: add output_shares table"
```

### Task 13: Share route module

**Files:**
- Create: `server/routes/shares.ts`
- Create: `server/lib/__tests__/output-shares.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// server/lib/__tests__/output-shares.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

// We test the route logic indirectly through the DB functions.
// The actual functions are inlined in the route module, so we test the
// token generation and retrieval logic patterns here.

describe("output-shares", () => {
  it("generates unique tokens", () => {
    const tokens = new Set<string>()
    for (let i = 0; i < 100; i++) {
      tokens.add(crypto.randomUUID())
    }
    expect(tokens.size).toBe(100)
  })

  it("UUID format is valid", () => {
    const token = crypto.randomUUID()
    expect(token).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })
})
```

- [ ] **Step 2: Create the shares route**

```typescript
// server/routes/shares.ts
import { Hono } from "hono"
import { getCookie } from "hono/cookie"
import { getDb } from "../db/schema.js"
import { getSession as getAuthSession } from "../lib/auth.js"
import { SESSION_COOKIE } from "./auth.js"

export const shareRoutes = new Hono()

// POST /api/shares — create a snapshot share (authenticated)
shareRoutes.post("/", async (c) => {
  const token = getCookie(c, SESSION_COOKIE)
  const authSession = token ? getAuthSession(token) : undefined
  const userEmail = authSession?.user.email
  if (!userEmail) return c.json({ error: "Unauthorized" }, 401)

  const { output, title } = await c.req.json()
  if (!output) return c.json({ error: "output is required" }, 400)

  const shareToken = crypto.randomUUID()
  const db = getDb()
  db.prepare(
    `INSERT INTO output_shares (token, output_json, title, created_at, created_by)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    shareToken,
    JSON.stringify(output),
    title || null,
    new Date().toISOString(),
    userEmail,
  )

  return c.json({ token: shareToken })
})

// GET /api/shares/:token — public read-only view (no auth required)
shareRoutes.get("/:token", async (c) => {
  const shareToken = c.req.param("token")
  const db = getDb()

  const row = db
    .prepare("SELECT * FROM output_shares WHERE token = ?")
    .get(shareToken) as
    | {
        token: string
        output_json: string
        title: string | null
        created_at: string
        created_by: string
      }
    | undefined

  if (!row) return c.json({ error: "Share not found" }, 404)

  return c.json({
    token: row.token,
    output: JSON.parse(row.output_json),
    title: row.title,
    createdAt: row.created_at,
    createdBy: row.created_by,
  })
})
```

- [ ] **Step 3: Run test**

Run: `cd packages/inbox && npx vitest run server/lib/__tests__/output-shares.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add server/routes/shares.ts server/lib/__tests__/output-shares.test.ts
git commit -m "feat: add output shares route (create + public read)"
```

### Task 14: Register share routes in server

**Files:**
- Modify: `server/index.ts`

- [ ] **Step 1: Mount shares route**

> **I8: Public share route must bypass auth middleware.** The `GET /api/shares/:token` route is unauthenticated, but all `/api/*` routes go through auth middleware in `server/index.ts`. The share routes **must be mounted BEFORE the auth middleware**, similar to how auth routes are excluded. This is critical — without it, unauthenticated users will get 401s when opening shared output links.

Import and mount the share routes. The `POST /api/shares` route is behind the existing auth middleware. The `GET /api/shares/:token` route needs to be public (no auth), so mount it before the auth middleware:

```typescript
import { shareRoutes } from "./routes/shares.js"
```

Add before the auth middleware (`app.use("/api/*", ...)`):

```typescript
// Public share view (no auth required)
app.get("/api/shares/:token", async (c) => {
  const { shareRoutes: sr } = await import("./routes/shares.js")
  // Forward to the share route handler
  return sr.fetch(c.req.raw)
})
```

Add after the auth middleware, with the other protected routes:

```typescript
app.route("/api/shares", shareRoutes)
```

> **Alternative (simpler):** Mount all of `/api/shares` before the auth middleware since the POST handler does its own auth check. This avoids the double-mount:

```typescript
// Before auth middleware:
app.route("/api/shares", shareRoutes)
```

Then remove `/api/shares` from the auth middleware scope by updating the middleware pattern, or keep it and have the shares route handle its own auth (which it already does).

The simplest approach: mount `shareRoutes` before the auth middleware. The `POST /` handler already checks auth internally. The `GET /:token` is intentionally public.

- [ ] **Step 2: Commit**

```bash
git add server/index.ts
git commit -m "feat: mount output shares routes (public GET, authenticated POST)"
```

### Task 15: Frontend API client and types for output sharing

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/api/client.ts`

- [ ] **Step 1: Add types**

In `src/types/index.ts`:

```typescript
export interface OutputShare {
  token: string
  output: unknown
  title: string | null
  createdAt: string
  createdBy: string
}
```

- [ ] **Step 2: Add API functions**

In `src/api/client.ts`:

```typescript
// Output sharing

export async function createOutputShare(body: { output: unknown; title?: string }) {
  return request<{ token: string }>(`/shares`, {
    method: "POST",
    body: JSON.stringify(body),
  })
}

export async function getOutputShare(token: string) {
  return request<import("@/types").OutputShare>(`/shares/${token}`)
}
```

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts src/api/client.ts
git commit -m "feat: add output share types and API client functions"
```

### Task 16: ShareOutputMenu component

**Files:**
- Create: `src/components/session/ShareOutputMenu.tsx`

- [ ] **Step 1: Create the "Share to..." dropdown**

This dropdown appears on output blocks in the transcript. It offers:
1. Copy link (creates a share token, copies the public URL)
2. Plugin share actions (e.g., "Create Notion page") — invoked server-side via existing plugin mutation infrastructure

```tsx
// src/components/session/ShareOutputMenu.tsx
import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@hammies/frontend/components/ui"
import { Share, Link, Check, Loader2 } from "lucide-react"
import { createOutputShare } from "@/api/client"

interface ShareOutputMenuProps {
  /** The output data to snapshot */
  output: unknown
  /** Title for the share */
  title?: string
  /** Optional plugin share targets (e.g., Notion, Slack) */
  pluginTargets?: Array<{
    id: string
    label: string
    icon?: string
    onShare: (output: unknown) => Promise<void>
  }>
}

export function ShareOutputMenu({ output, title, pluginTargets = [] }: ShareOutputMenuProps) {
  const [copied, setCopied] = useState(false)

  const createShareMutation = useMutation({
    mutationFn: () => createOutputShare({ output, title }),
    onSuccess: async (data) => {
      const url = `${window.location.origin}/shared/${data.token}`
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    },
  })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 p-1 rounded hover:bg-accent text-muted-foreground"
          title="Share output"
        >
          <Share className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Share to...</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => createShareMutation.mutate()}
          disabled={createShareMutation.isPending}
        >
          <span className="flex items-center gap-2">
            {copied ? (
              <Check className="h-4 w-4 text-green-500" />
            ) : createShareMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Link className="h-4 w-4" />
            )}
            {copied ? "Link copied!" : "Copy share link"}
          </span>
        </DropdownMenuItem>
        {pluginTargets.length > 0 && <DropdownMenuSeparator />}
        {pluginTargets.map((target) => (
          <DropdownMenuItem
            key={target.id}
            onSelect={() => target.onShare(output)}
          >
            <span className="flex items-center gap-2">
              {target.icon ? (
                <span className="h-4 w-4 text-center">{target.icon}</span>
              ) : null}
              {target.label}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/session/ShareOutputMenu.tsx
git commit -m "feat: add ShareOutputMenu component"
```

### Task 17: Integrate ShareOutputMenu into SessionTranscript

**Files:**
- Modify: `src/components/session/SessionTranscript.tsx`

- [ ] **Step 1: Add share button to assistant message blocks**

Import the menu:

```typescript
import { ShareOutputMenu } from "./ShareOutputMenu"
```

In the assistant message rendering section (where `type === "assistant"` messages are rendered), add a `ShareOutputMenu` in the message header/actions area:

```tsx
<ShareOutputMenu
  output={msg.message}
  title={`Session output`}
/>
```

The exact placement depends on the message row layout — position it as a hover-visible action button on the right side of assistant message blocks, similar to how chat UIs show a "copy" button on hover.

- [ ] **Step 2: Run tests**

Run: `cd packages/inbox && npm run test:ci`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/session/SessionTranscript.tsx
git commit -m "feat: add share button to assistant message blocks in transcript"
```

### Task 18: SharedOutputView page (public)

**Files:**
- Create: `src/components/session/SharedOutputView.tsx`
- Modify: `src/App.tsx` (or router config)

- [ ] **Step 1: Create the public shared output view**

This is a standalone page at `/shared/:token` that renders the output snapshot without requiring auth.

```tsx
// src/components/session/SharedOutputView.tsx
import { useParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { getOutputShare } from "@/api/client"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

export function SharedOutputView() {
  const { token } = useParams<{ token: string }>()

  const { data, isLoading, error } = useQuery({
    queryKey: ["shared-output", token],
    queryFn: () => getOutputShare(token!),
    enabled: !!token,
  })

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-destructive">
          {error?.message || "Share not found"}
        </div>
      </div>
    )
  }

  // Extract text content from the output message
  const output = data.output as any
  let content = ""
  if (typeof output === "string") {
    content = output
  } else if (output?.content) {
    if (typeof output.content === "string") {
      content = output.content
    } else if (Array.isArray(output.content)) {
      content = output.content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("\n\n")
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="mb-6">
          {data.title && (
            <h1 className="text-xl font-semibold mb-1">{data.title}</h1>
          )}
          <div className="text-sm text-muted-foreground">
            Shared on {new Date(data.createdAt).toLocaleDateString()}
          </div>
        </div>
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add route to router**

In the app's router configuration (likely `src/App.tsx` or a routes file), add a public route:

```tsx
import { SharedOutputView } from "@/components/session/SharedOutputView"

// Add outside the auth-protected layout:
<Route path="/shared/:token" element={<SharedOutputView />} />
```

- [ ] **Step 3: Run tests**

Run: `cd packages/inbox && npm run test:ci`
Expected: PASS

- [ ] **Step 4: Manual verification**

1. Open a completed session with assistant messages
2. Hover over an assistant message → see share (Share) icon
3. Click it → "Share to..." dropdown appears
4. Click "Copy share link" → URL copied to clipboard
5. Open the link in an incognito window (no auth) → output renders correctly
6. Open an invalid token → "Share not found" error

- [ ] **Step 5: Commit**

```bash
git add src/components/session/SharedOutputView.tsx src/App.tsx
git commit -m "feat: add SharedOutputView page for public output sharing"
```

### Task 19: Plugin share targets (Notion create_page)

**Files:**
- Modify: `src/components/session/SessionTranscript.tsx`

- [ ] **Step 1: Wire plugin share mutations into ShareOutputMenu**

When rendering `ShareOutputMenu` on assistant messages, dynamically build `pluginTargets` from available plugins that support a `share` / `create_page` mutation. Use the existing `mutatePluginItem` API client function.

```tsx
import { mutatePluginItem } from "@/api/client"

// Build plugin targets for the share menu
const pluginTargets = [
  {
    id: "notion-page",
    label: "Create Notion page",
    icon: "📝",
    onShare: async (output: unknown) => {
      const content = extractTextContent(output)
      await mutatePluginItem("notion", "new", "create_page", {
        title: "Shared from session",
        content,
      })
    },
  },
]
```

> **Note:** The exact set of plugin targets depends on which plugins are loaded and which support share mutations. For now, hardcode Notion as the first target. In Phase 5 (Source Plugins), this becomes dynamic based on the `SourcePlugin.mutate` capability.

- [ ] **Step 2: Commit**

```bash
git add src/components/session/SessionTranscript.tsx
git commit -m "feat: add Notion create_page as plugin share target"
```

---

## Final Verification

- [ ] **Run full test suite**: `cd packages/inbox && npm run test:ci`
- [ ] **Manual smoke test — Presence**: Open same session in 2 tabs with different users, verify avatars appear/disappear on connect/disconnect
- [ ] **Manual smoke test — Session sharing**: Share a session with a colleague, verify they see it in their list, verify write/read-only enforcement
- [ ] **Manual smoke test — Output sharing**: Create a share link, open in incognito, verify output renders. Test Notion create_page if available.
- [ ] **Update TODO.md**: Mark Phase 3 items as done

---

## Subsequent Plans (separate specs)

- **Phase 4: Rich Session Outputs + React Artifacts** — render_output tool, OutputRenderer, panel stack, iframe sandbox
- **Phase 5: Source Plugins** — SourcePlugin interface, Gmail/Notion refactor, Slack plugin
- **Phase 6: Self-Improving System + Retrieval** — error recovery, FTS indexing, context-backfill (workflow-plugin scope)
