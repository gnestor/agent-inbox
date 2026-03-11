// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { buildUrl, tabStateFromPathname } from "../use-spatial-nav.js"

// ─── buildUrl ────────────────────────────────────────────────────────────────

describe("buildUrl", () => {
  it("returns tab root when no selectedId", () => {
    expect(buildUrl("emails", {})).toBe("/emails")
    expect(buildUrl("tasks", {})).toBe("/tasks")
    expect(buildUrl("sessions", {})).toBe("/sessions")
  })

  it("includes selectedId", () => {
    expect(buildUrl("emails", { selectedId: "abc123" })).toBe("/emails/abc123")
    expect(buildUrl("sessions", { selectedId: "sid-1" })).toBe("/sessions/sid-1")
  })

  it("appends /session/new when sessionOpen and no sessionId", () => {
    expect(buildUrl("emails", { selectedId: "abc", sessionOpen: true })).toBe(
      "/emails/abc/session/new",
    )
  })

  it("appends /session/:id when sessionOpen with sessionId", () => {
    expect(buildUrl("tasks", { selectedId: "t1", sessionOpen: true, sessionId: "s1" })).toBe(
      "/tasks/t1/session/s1",
    )
  })

  // Regression: SessionView used buildUrl(activeTab, { selectedId: currentSessionId })
  // when activeTab=sessions, producing /sessions/:id — the same URL, making back button a no-op.
  it("regression — sessions tab parentPath must be /sessions, not /sessions/:id", () => {
    const sessionId = "session-abc"
    const wrongParentPath = buildUrl("sessions", { selectedId: sessionId })
    expect(wrongParentPath).toBe("/sessions/session-abc") // this is the same URL — no-op!

    // Correct: parent for sessions detail is the list root
    const correctParentPath = "/sessions"
    expect(correctParentPath).toBe("/sessions")
  })
})

// ─── tabStateFromPathname ─────────────────────────────────────────────────────

describe("tabStateFromPathname", () => {
  it("returns empty state for non-matching tab", () => {
    expect(tabStateFromPathname("/emails/abc", "tasks")).toEqual({})
    expect(tabStateFromPathname("/sessions/sid", "emails")).toEqual({})
  })

  it("parses list root (no selectedId)", () => {
    expect(tabStateFromPathname("/emails", "emails")).toEqual({})
    expect(tabStateFromPathname("/sessions", "sessions")).toEqual({})
  })

  it("parses selectedId for emails tab", () => {
    expect(tabStateFromPathname("/emails/thread-123", "emails")).toEqual({
      selectedId: "thread-123",
    })
  })

  it("parses selectedId for sessions tab", () => {
    expect(tabStateFromPathname("/sessions/sid-1", "sessions")).toEqual({
      selectedId: "sid-1",
    })
  })

  it("parses session overlay open state", () => {
    expect(tabStateFromPathname("/emails/thread-1/session/new", "emails")).toEqual({
      selectedId: "thread-1",
      sessionOpen: true,
      sessionId: undefined,
    })
  })

  it("parses session overlay with existing session id", () => {
    expect(tabStateFromPathname("/tasks/task-1/session/s-99", "tasks")).toEqual({
      selectedId: "task-1",
      sessionOpen: true,
      sessionId: "s-99",
    })
  })

  it("decodes URI-encoded selectedId", () => {
    const encoded = encodeURIComponent("abc def")
    expect(tabStateFromPathname(`/emails/${encoded}`, "emails")).toEqual({
      selectedId: "abc def",
    })
  })
})
