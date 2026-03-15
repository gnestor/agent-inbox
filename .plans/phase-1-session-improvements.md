# Phase 1: Session Improvements — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add auto-naming, inline rename, and attach-source-to-session — three quick wins that make sessions easier to find and use.

**Architecture:** All three features touch the same vertical slice: `sessions` DB table → session-manager → sessions route → API client → SessionView/SessionList components. No new tables or dependencies.

**Tech Stack:** Hono routes, better-sqlite3, React 19, TanStack Query, Anthropic SDK (Haiku), SSE

---

## File Structure

```
server/
├── lib/
│   ├── session-manager.ts       — MODIFY: add updateSessionSummary(), attachSourceToSession()
│   ├── title-generator.ts       — CREATE: generateSessionTitle() using Claude Haiku
│   └── __tests__/
│       └── title-generator.test.ts  — CREATE: tests for title generation
├── routes/
│   └── sessions.ts              — MODIFY: add PATCH /:id, POST /:id/attach
src/
├── api/
│   └── client.ts                — MODIFY: add updateSession(), attachToSession()
├── components/
│   └── session/
│       ├── SessionView.tsx       — MODIFY: make title editable on click
│       ├── SessionList.tsx       — (no changes needed — already shows summary)
│       ├── AttachToSessionMenu.tsx — CREATE: "Add to session" dropdown + session picker
│       └── __tests__/
│           └── title-generator.test.ts — CREATE: mock-based tests
├── hooks/
│   └── use-session-mutation.ts   — CREATE: mutation hooks for rename + attach
```

---

## Chunk 1: Auto-naming

After a session completes, call Claude Haiku to generate a short title from the transcript. Store it in `sessions.summary`, which the session list already displays.

### Task 1: Title generator module

**Files:**
- Create: `server/lib/title-generator.ts`
- Create: `server/lib/__tests__/title-generator.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// server/lib/__tests__/title-generator.test.ts
import { describe, it, expect, vi } from "vitest"
import { buildTitlePrompt, parseTitleResponse } from "../title-generator.js"

describe("title-generator", () => {
  describe("buildTitlePrompt", () => {
    it("includes user prompt and assistant summary", () => {
      const messages = [
        { type: "user", message: JSON.stringify({ type: "user", content: "Draft an email to Kevin about Q1 results" }) },
        { type: "assistant", message: JSON.stringify({ type: "assistant", content: "I've drafted the email..." }) },
      ]
      const result = buildTitlePrompt(messages as any)
      expect(result).toContain("Q1 results")
    })

    it("truncates long transcripts to fit context", () => {
      const messages = Array.from({ length: 100 }, (_, i) => ({
        type: "user",
        message: JSON.stringify({ type: "user", content: `Message ${i} with lots of content `.repeat(50) }),
      }))
      const result = buildTitlePrompt(messages as any)
      // Should not exceed ~4000 chars of transcript content
      expect(result.length).toBeLessThan(6000)
    })
  })

  describe("parseTitleResponse", () => {
    it("extracts clean title from response", () => {
      expect(parseTitleResponse("Draft Q1 results email to Kevin")).toBe("Draft Q1 results email to Kevin")
    })

    it("strips surrounding quotes", () => {
      expect(parseTitleResponse('"Draft Q1 email"')).toBe("Draft Q1 email")
    })

    it("truncates to 60 chars", () => {
      const long = "A".repeat(80)
      expect(parseTitleResponse(long).length).toBeLessThanOrEqual(60)
    })

    it("returns null for empty response", () => {
      expect(parseTitleResponse("")).toBeNull()
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/inbox && npx vitest run server/lib/__tests__/title-generator.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write minimal implementation**

```typescript
// server/lib/title-generator.ts

const TITLE_SYSTEM_PROMPT = `You generate short titles for AI assistant sessions. Given a transcript excerpt, produce a concise title (max 60 chars) that captures the main task. Rules:
- Use imperative or noun-phrase form ("Draft Q1 email", "Debug auth middleware", "Analyze sales data")
- No quotes, no prefix like "Title:", just the title text
- If the session covers multiple topics, title the primary one`

/**
 * Build the prompt for Haiku from session messages.
 * Takes first 3 user messages + last assistant message to stay under context limits.
 */
export function buildTitlePrompt(
  messages: Array<{ type: string; message: string }>
): string {
  const parsed = messages
    .filter((m) => m.type === "user" || m.type === "assistant")
    .map((m) => {
      try {
        const obj = JSON.parse(m.message)
        const content = typeof obj.content === "string"
          ? obj.content
          : Array.isArray(obj.content)
            ? obj.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join(" ")
            : ""
        return { role: obj.type || m.type, content: content.slice(0, 500) }
      } catch {
        return null
      }
    })
    .filter(Boolean) as Array<{ role: string; content: string }>

  // Take first 3 user messages and last assistant message
  const userMsgs = parsed.filter((m) => m.role === "user").slice(0, 3)
  const lastAssistant = parsed.filter((m) => m.role === "assistant").pop()

  const parts = [
    ...userMsgs.map((m) => `User: ${m.content}`),
    ...(lastAssistant ? [`Assistant: ${lastAssistant.content}`] : []),
  ]

  return parts.join("\n\n")
}

/**
 * Parse Haiku's response into a clean title.
 */
export function parseTitleResponse(response: string): string | null {
  let title = response.trim()
  if (!title) return null

  // Strip surrounding quotes
  if ((title.startsWith('"') && title.endsWith('"')) ||
      (title.startsWith("'") && title.endsWith("'"))) {
    title = title.slice(1, -1)
  }

  // Strip common prefixes
  title = title.replace(/^(Title:\s*)/i, "")

  // Truncate to 60 chars
  if (title.length > 60) {
    title = title.slice(0, 57) + "..."
  }

  return title || null
}

/**
 * Generate a session title using Claude Haiku.
 * Returns the title string, or null if generation fails.
 */
export async function generateSessionTitle(
  messages: Array<{ type: string; message: string }>
): Promise<string | null> {
  const transcript = buildTitlePrompt(messages)
  if (!transcript) return null

  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default
    const client = new Anthropic() // uses ANTHROPIC_API_KEY from env

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 100,
      system: TITLE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: transcript }],
    })

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")

    return parseTitleResponse(text)
  } catch (err) {
    console.error("Title generation failed:", err)
    return null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/inbox && npx vitest run server/lib/__tests__/title-generator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/lib/title-generator.ts server/lib/__tests__/title-generator.test.ts
git commit -m "feat: add title-generator module for session auto-naming"
```

### Task 2: Wire auto-naming into session lifecycle

**Files:**
- Modify: `server/lib/session-manager.ts` (lines 124-137, 294-300, 384-386)

- [ ] **Step 1: Add auto-naming call after session completion**

In `session-manager.ts`, import the title generator at the top:

```typescript
import { generateSessionTitle } from "./title-generator.js"
```

Then create a helper that runs after session completion:

```typescript
async function autoNameSession(sessionId: string) {
  try {
    const messages = getSessionMessages(sessionId)
    if (messages.length < 2) return // Skip trivial sessions (e.g. immediate errors)

    const title = await generateSessionTitle(
      messages.map((m) => ({ type: m.type as string, message: m.message as string }))
    )
    if (title) {
      updateSessionSummary(sessionId, title)
    }
  } catch (err) {
    console.error("Auto-naming failed for session", sessionId, err)
  }
}
```

Add `updateSessionSummary` to the existing DB functions:

```typescript
export function updateSessionSummary(sessionId: string, summary: string) {
  const db = getDb()
  db.prepare("UPDATE sessions SET summary = ?, updated_at = ? WHERE id = ?")
    .run(summary, new Date().toISOString(), sessionId)
}
```

- [ ] **Step 2: Call autoNameSession in both completion paths**

In `startSession()`, after `updateSessionStatus(sessionId, "complete")` (line ~306), add:

```typescript
autoNameSession(sessionId).catch(() => {})
```

In `resumeSessionQuery()`, after `updateSessionStatus(sessionId, "complete")` (line ~386), add:

```typescript
autoNameSession(sessionId).catch(() => {})
```

The `.catch(() => {})` ensures auto-naming failures don't affect session completion.

- [ ] **Step 3: Fallback — set summary from prompt if auto-naming fails**

> **Note on completion flow:** The result-message handler at line ~296 sets summary to the first 200 chars of the result via `updateSessionStatus`. This serves as an instant fallback. Then `autoNameSession` runs async and calls `updateSessionSummary` (a direct `SET summary = ?`), which intentionally overwrites with the Haiku-generated title. This is the correct behavior — the result excerpt is a fast placeholder that gets replaced by a proper title.

In `createSessionRecord()`, ensure we set an initial summary from the prompt so sessions always have a displayable title even before auto-naming runs.

Change the existing INSERT (line ~87-100 of session-manager.ts) from:

```typescript
db.prepare(
  `INSERT INTO sessions (id, status, prompt, started_at, updated_at, linked_email_id, linked_email_thread_id, linked_task_id, trigger_source, metadata)
   VALUES (?, 'running', ?, ?, ?, ?, ?, ?, ?, ?)`
).run(
  sessionId, prompt, now, now,
  options?.linkedEmailId || null,
  options?.linkedEmailThreadId || null,
  options?.linkedTaskId || null,
  options?.triggerSource || "manual",
  metadata,
)
```

To:

```typescript
db.prepare(
  `INSERT INTO sessions (id, status, prompt, summary, started_at, updated_at, linked_email_id, linked_email_thread_id, linked_task_id, trigger_source, metadata)
   VALUES (?, 'running', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
).run(
  sessionId, prompt, prompt.slice(0, 80), now, now,
  options?.linkedEmailId || null,
  options?.linkedEmailThreadId || null,
  options?.linkedTaskId || null,
  options?.triggerSource || "manual",
  metadata,
)
```

- [ ] **Step 5: Run full test suite**

Run: `cd packages/inbox && npm run test:ci`
Expected: PASS (all existing + new tests)

- [ ] **Step 6: Commit**

```bash
git add server/lib/session-manager.ts
git commit -m "feat: wire auto-naming into session completion lifecycle"
```

---

## Chunk 2: Inline Rename

Make the session title in `SessionView` header clickable to edit in-place.

### Task 3: Server route for updating session summary

**Files:**
- Modify: `server/routes/sessions.ts`

- [ ] **Step 1: Add PATCH /:id route**

```typescript
sessionRoutes.patch("/:id", async (c) => {
  const sessionId = c.req.param("id")
  const { summary } = await c.req.json()

  if (typeof summary !== "string") {
    return c.json({ error: "summary must be a string" }, 400)
  }

  const session = sessions.getSessionRecord(sessionId)
  if (!session) {
    return c.json({ error: "Session not found" }, 404)
  }

  sessions.updateSessionSummary(sessionId, summary.slice(0, 200))
  return c.json({ ok: true })
})
```

- [ ] **Step 2: Run tests**

Run: `cd packages/inbox && npm run test:ci`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add server/routes/sessions.ts
git commit -m "feat: add PATCH /sessions/:id route for renaming"
```

### Task 4: API client function

**Files:**
- Modify: `src/api/client.ts`

- [ ] **Step 1: Add updateSession function**

Add after the existing `getSession` function (~line 196):

```typescript
export async function updateSession(sessionId: string, body: { summary: string }) {
  return request<{ ok: boolean }>(`/sessions/${sessionId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add src/api/client.ts
git commit -m "feat: add updateSession API client function"
```

### Task 5: Editable title in SessionView

**Files:**
- Modify: `src/components/session/SessionView.tsx` (lines 153-164)

- [ ] **Step 1: Add rename state and mutation**

Add imports at the top:

```typescript
import { updateSession } from "@/api/client"
```

Inside `SessionView`, add state and mutation after the existing `abortMutation`.

> **Note:** Task 7 creates a `useRenameSession` hook. Once Task 7 is complete, refactor this inline mutation to use `useRenameSession(sessionId)` instead. For now, inline is fine since Task 5 executes before Task 7.

```typescript
const [isEditing, setIsEditing] = useState(false)
const [editTitle, setEditTitle] = useState("")

const renameMutation = useMutation({
  mutationFn: (newTitle: string) => updateSession(sessionId, { summary: newTitle }),
  onSuccess: () => {
    qc.invalidateQueries({ queryKey: ["session", sessionId] })
    qc.invalidateQueries({ queryKey: ["sessions"] })
  },
})

function handleStartEdit() {
  setEditTitle(data?.session.summary || data?.session.prompt?.slice(0, 80) || displayTitle)
  setIsEditing(true)
}

function handleFinishEdit() {
  setIsEditing(false)
  const trimmed = editTitle.trim()
  if (trimmed && trimmed !== displayTitle) {
    renameMutation.mutate(trimmed)
  }
}

function handleEditKeyDown(e: React.KeyboardEvent) {
  if (e.key === "Enter") {
    e.preventDefault()
    handleFinishEdit()
  }
  if (e.key === "Escape") {
    setIsEditing(false)
  }
}
```

- [ ] **Step 2: Replace static title with editable version**

In the header JSX (~line 163), replace:

```tsx
<h2 className="font-semibold text-sm truncate min-w-0">{displayTitle}</h2>
```

With:

```tsx
{isEditing ? (
  <input
    autoFocus
    value={editTitle}
    onChange={(e) => setEditTitle(e.target.value)}
    onBlur={handleFinishEdit}
    onKeyDown={handleEditKeyDown}
    className="font-semibold text-sm bg-transparent border-b border-foreground/30 outline-none min-w-0 w-full"
    maxLength={200}
  />
) : (
  <h2
    className="font-semibold text-sm truncate min-w-0 cursor-pointer hover:text-foreground/70"
    onClick={handleStartEdit}
    title="Click to rename"
  >
    {displayTitle}
  </h2>
)}
```

- [ ] **Step 3: Run tests**

Run: `cd packages/inbox && npm run test:ci`
Expected: PASS

- [ ] **Step 4: Manual verification**

1. Open a completed session
2. Click the title → input appears with current title
3. Edit the title, press Enter → title updates in header and session list
4. Press Escape → edit cancels
5. Click away (blur) → saves if changed

- [ ] **Step 5: Commit**

```bash
git add src/components/session/SessionView.tsx
git commit -m "feat: inline editable session title on click"
```

---

## Chunk 3: Attach Source to Existing Session

Add "Add to session" action on emails/tasks that lets users attach context to an existing session.

### Task 6: Server route for attaching source

**Files:**
- Modify: `server/routes/sessions.ts`
- Modify: `server/lib/session-manager.ts`

- [ ] **Step 1: Add attachSourceToSession to session-manager**

```typescript
export function attachSourceToSession(
  sessionId: string,
  source: { type: string; id: string; title: string; content: string }
) {
  const messages = getSessionMessages(sessionId)
  const nextSequence = messages.length

  const contextMessage = {
    type: "system",
    subtype: "attached_context",
    sourceType: source.type,
    sourceId: source.id,
    title: source.title,
    content: source.content,
  }

  appendSessionMessage(sessionId, nextSequence, "system", contextMessage)
  broadcastToSession(sessionId, { sequence: nextSequence, message: contextMessage })

  // Update linked source columns (last attachment wins — the actual context
  // is preserved in session_messages regardless, so multiple attachments work)
  const db = getDb()
  db.prepare(
    "UPDATE sessions SET linked_source_id = ?, linked_source_type = ?, updated_at = ? WHERE id = ?"
  ).run(source.id, source.type, new Date().toISOString(), sessionId)
}
```

- [ ] **Step 2: Add POST /:id/attach route**

```typescript
sessionRoutes.post("/:id/attach", async (c) => {
  const sessionId = c.req.param("id")
  const { type, id, title, content } = await c.req.json()

  if (!type || !id || !content) {
    return c.json({ error: "type, id, and content are required" }, 400)
  }

  const session = sessions.getSessionRecord(sessionId)
  if (!session) {
    return c.json({ error: "Session not found" }, 404)
  }

  sessions.attachSourceToSession(sessionId, {
    type,
    id,
    title: title || `${type} ${id}`,
    content,
  })

  return c.json({ ok: true })
})
```

- [ ] **Step 3: Run tests**

Run: `cd packages/inbox && npm run test:ci`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add server/lib/session-manager.ts server/routes/sessions.ts
git commit -m "feat: add POST /sessions/:id/attach route for attaching sources"
```

### Task 7: API client + mutation hook

**Files:**
- Modify: `src/api/client.ts`
- Create: `src/hooks/use-session-mutation.ts`

- [ ] **Step 1: Add attachToSession to API client**

```typescript
export async function attachToSession(
  sessionId: string,
  body: { type: string; id: string; title: string; content: string }
) {
  return request<{ ok: boolean }>(`/sessions/${sessionId}/attach`, {
    method: "POST",
    body: JSON.stringify(body),
  })
}
```

- [ ] **Step 2: Create mutation hook**

```typescript
// src/hooks/use-session-mutation.ts
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { updateSession, attachToSession } from "@/api/client"

export function useRenameSession(sessionId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (summary: string) => updateSession(sessionId, { summary }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["session", sessionId] })
      qc.invalidateQueries({ queryKey: ["sessions"] })
    },
  })
}

export function useAttachToSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      sessionId,
      source,
    }: {
      sessionId: string
      source: { type: string; id: string; title: string; content: string }
    }) => attachToSession(sessionId, source),
    onSuccess: (_, { sessionId }) => {
      qc.invalidateQueries({ queryKey: ["session", sessionId] })
      qc.invalidateQueries({ queryKey: ["sessions"] })
    },
  })
}
```

- [ ] **Step 3: Commit**

```bash
git add src/api/client.ts src/hooks/use-session-mutation.ts
git commit -m "feat: add attachToSession API client + mutation hooks"
```

### Task 8: "Add to session" UI component

**Files:**
- Create: `src/components/session/AttachToSessionMenu.tsx`

- [ ] **Step 1: Create the AttachToSessionMenu component**

This is a dropdown that shows recent sessions and lets the user pick one:

```tsx
// src/components/session/AttachToSessionMenu.tsx
import { useState } from "react"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@hammies/frontend/components/ui"
import { Plus } from "lucide-react"
import { useSessions } from "@/hooks/use-sessions"
import { useAttachToSession } from "@/hooks/use-session-mutation"
import { truncate } from "@/lib/formatters"

interface AttachToSessionMenuProps {
  source: { type: string; id: string; title: string; content: string }
}

export function AttachToSessionMenu({ source }: AttachToSessionMenuProps) {
  const [open, setOpen] = useState(false)
  const { sessions } = useSessions(undefined, open)
  const attachMutation = useAttachToSession()

  function handleSelect(sessionId: string) {
    attachMutation.mutate({ sessionId, source })
    setOpen(false)
  }

  // Show recent sessions (last 10, exclude completed long ago)
  const recentSessions = sessions.slice(0, 10)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          />
        }
      >
        <Plus className="h-3 w-3" />
        Add to session
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Add to session</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {recentSessions.length === 0 && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">No sessions</div>
        )}
        {recentSessions.map((session) => (
          <DropdownMenuItem
            key={session.id}
            onSelect={() => handleSelect(session.id)}
          >
            <span className="truncate">
              {session.summary || truncate(session.prompt, 50)}
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
git add src/components/session/AttachToSessionMenu.tsx
git commit -m "feat: add AttachToSessionMenu component"
```

### Task 9: Render attached_context messages in SessionTranscript

**Files:**
- Modify: `src/components/session/SessionTranscript.tsx`

The SSE stream will broadcast `attached_context` messages, but `SessionTranscript` needs to know how to render them. Without this, attached context would be invisible.

- [ ] **Step 1: Add rendering for attached_context system messages**

In `SessionTranscript.tsx`, find where message types are rendered (the message rendering switch/conditional). Add a case for system messages with `subtype: "attached_context"`:

```tsx
// Inside the message rendering logic, add:
if (msg.type === "system" && msg.subtype === "attached_context") {
  return (
    <div className="flex items-start gap-2 px-4 py-2 bg-muted/50 rounded-md mx-4 my-1">
      <Paperclip className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
      <div className="text-sm">
        <span className="font-medium">{msg.title}</span>
        <span className="text-muted-foreground ml-1">attached</span>
      </div>
    </div>
  )
}
```

Add `Paperclip` to the lucide-react imports.

- [ ] **Step 2: Run tests**

Run: `cd packages/inbox && npm run test:ci`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/session/SessionTranscript.tsx
git commit -m "feat: render attached_context messages in session transcript"
```

### Task 10: Integrate AttachToSessionMenu into source views

**Files:**
- Modify: `src/components/email/EmailThread.tsx`
- Modify: `src/components/task/TaskDetail.tsx`
- Modify: `src/components/task/CalendarDetail.tsx`

- [ ] **Step 1: Add to EmailThread header**

Import and add `AttachToSessionMenu` in the header area of `EmailThread.tsx`. The source payload should include the thread subject and a text summary of the thread:

```tsx
import { AttachToSessionMenu } from "@/components/session/AttachToSessionMenu"

// In the header actions area, add:
<AttachToSessionMenu
  source={{
    type: "email",
    id: threadId,
    title: thread.subject,
    content: `Email thread: ${thread.subject}\n\nFrom: ${thread.messages[0]?.from}\n\n${thread.messages.map(m => m.snippet).join("\n---\n")}`,
  }}
/>
```

The exact integration point depends on the current EmailThread header layout — place it near other action buttons (archive, label, etc.).

- [ ] **Step 2: Add to TaskDetail header**

Similar pattern for task detail — source content is the task title + description:

```tsx
<AttachToSessionMenu
  source={{
    type: "task",
    id: taskId,
    title: task.title,
    content: `Notion task: ${task.title}\nStatus: ${task.status}\n\n${task.description || ""}`,
  }}
/>
```

- [ ] **Step 3: Add to CalendarDetail header**

Note: CalendarDetail uses Notion property paths. Adapt to actual data shape:

```tsx
<AttachToSessionMenu
  source={{
    type: "calendar",
    id: itemId,
    title: item.title,
    content: `Calendar item: ${item.title}\nDate: ${item?.properties?.["Date"]?.date?.start || "unknown"}\nStatus: ${item?.properties?.["Status"]?.status?.name || ""}`,
  }}
/>
```

- [ ] **Step 4: Run full test suite**

Run: `cd packages/inbox && npm run test:ci`
Expected: PASS

- [ ] **Step 5: Manual verification**

1. Open an email thread → see "Add to session" action
2. Click it → dropdown shows recent sessions
3. Select a session → context message appears in the session transcript
4. Resume the session → agent acknowledges the attached context
5. Repeat for a Notion task and calendar item

- [ ] **Step 6: Commit**

```bash
git add src/components/email/EmailThread.tsx src/components/task/TaskDetail.tsx src/components/task/CalendarDetail.tsx
git commit -m "feat: integrate AttachToSessionMenu into email, task, and calendar views"
```

---

## Final Verification

- [ ] **Run full test suite**: `cd packages/inbox && npm run test:ci`
- [ ] **Manual smoke test**: Create a session, let it complete, verify auto-naming, rename it, attach an email to it, resume with a follow-up prompt
- [ ] **Update TODO.md**: Mark session improvements as done

---

## Subsequent Plans (separate specs)

These are independent subsystems and should each get their own implementation plan:

- **Phase 2: Multi-User Auth + Credential Proxy** — DB tables, vault, HTTPS proxy, OAuth flows, settings UI
- **Phase 3: Collaboration + Output Sharing** — presence, session sharing, output snapshots
- **Phase 4: Rich Session Outputs + React Artifacts** — render_output tool, OutputRenderer, panel stack, iframe sandbox
- **Phase 5: Source Plugins** — SourcePlugin interface, Gmail/Notion refactor, Slack plugin
- **Phase 6: Self-Improving System + Retrieval** — error recovery, FTS indexing, context-backfill (workflow-plugin scope)
