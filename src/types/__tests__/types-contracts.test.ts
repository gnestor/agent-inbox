import { describe, it, expect } from "vitest"
import type {
  UserProfile,
  Workspace,
  WorkspaceMember,
  SessionStatus,
  TriggerSource,
  Session,
  InboxContextData,
  InboxResultData,
  InboxResultAction,
} from "../index"
import type { Plugin, FieldDef, PluginContext, PluginComponents } from "../plugin"
import type { WidgetDef } from "../panels"

// These tests pin the public TYPE contracts via `satisfies` (enforced at
// `tsc -b`) plus runtime narrowing assertions on representative values.

describe("wire-shape types (src/types/index.ts)", () => {
  it("Scenario: `UserProfile`, `Workspace`, `WorkspaceMember` cover identity and membership — fields match the API client output", () => {
    const user = { name: "Alice", email: "alice@x.com", picture: "p.jpg" } satisfies UserProfile
    const ws = { id: "ws1", name: "Acme", role: "admin" } satisfies Workspace
    const member = {
      workspace_id: "ws1",
      user_email: "alice@x.com",
      role: "member",
      created_at: "2026-01-01",
      name: "Alice",
      picture: "p.jpg",
    } satisfies WorkspaceMember

    expect(user.email).toBe("alice@x.com")
    // picture is optional on UserProfile.
    const noPic = { name: "Bob", email: "bob@x.com" } satisfies UserProfile
    expect(noPic.picture).toBeUndefined()
    // Workspace.role is the admin|member union.
    expect(["admin", "member"]).toContain(ws.role)
    expect(member.workspace_id).toBe("ws1")
  })

  it("Scenario: `SessionStatus` is a closed string union — only the six documented values are valid", () => {
    const all: SessionStatus[] = [
      "running",
      "complete",
      "needs_attention",
      "errored",
      "awaiting_user_input",
      "archived",
    ]
    expect(all).toHaveLength(6)
    // @ts-expect-error — an undocumented status is not assignable.
    const bad: SessionStatus = "paused"
    expect(bad).toBe("paused")
  })

  it("Scenario: `TriggerSource` is an open union with documented core values — named values plus `(string & {})` escape hatch", () => {
    const manual: TriggerSource = "manual"
    const inbox: TriggerSource = "inbox"
    const webhook: TriggerSource = "webhook"
    // Plugin-defined values still satisfy the type (open union via `string & {}`).
    const custom: TriggerSource = "my-plugin-trigger"
    expect([manual, inbox, webhook, custom]).toHaveLength(4)
  })

  it("Scenario: `Session` carries optional `hasActiveProcess` — present means a live in-memory agent process", () => {
    const base = {
      id: "s1",
      status: "running" as SessionStatus,
      prompt: "do it",
      summary: null,
      startedAt: "2026-01-01",
      updatedAt: "2026-01-01",
      completedAt: null,
      linkedSourceType: null,
      linkedSourceId: null,
      triggerSource: "manual" as TriggerSource,
      project: "agent",
      linkedItemTitle: null,
    } satisfies Session
    // hasActiveProcess is optional — omitted is valid.
    expect(base.hasActiveProcess).toBeUndefined()
    const live = { ...base, hasActiveProcess: true } satisfies Session
    expect(live.hasActiveProcess).toBe(true)
  })

  it("Scenario: `InboxContextData` and `InboxResultData` mirror the agent's structured output — result action union + optional pluginId", () => {
    const actions: InboxResultAction[] = ["draft", "task", "context_updated", "skipped"]
    expect(actions).toHaveLength(4)

    const result = {
      action: "draft",
      pluginId: "gmail",
      summary: "Drafted a reply",
    } satisfies InboxResultData
    expect(result.pluginId).toBe("gmail")

    const ctx = {
      entity: { type: "person", name: "Caroline", email: null, domain: null, company: null, role: null },
      source: { type: "gmail", id: "m1", threadId: null, subject: null, from: null, date: null, snippet: "" },
      contextPages: [],
      relatedThreads: [],
      relatedTasks: [],
      summary: "",
    } satisfies InboxContextData
    expect(ctx.entity.type).toBe("person")
  })
})

describe("plugin interface (src/types/plugin.ts)", () => {
  it("Scenario: `Plugin` is the single type implemented by every plugin file — id/name/icon required, all methods optional", () => {
    // Skills-only plugin: no data methods at all.
    const skillsOnly = {
      id: "skills",
      name: "Skills",
      icon: "Sparkles",
      hasSkills: true,
    } satisfies Plugin
    expect(skillsOnly.query).toBeUndefined()

    // Full data plugin exercises the optional method surface.
    const full = {
      id: "gmail",
      name: "Gmail",
      icon: "Mail",
      emoji: "📧",
      components: { tab: "gmail:tab" },
      auth: { integrationId: "google", scope: "user" },
      query: async () => ({ items: [] }),
      mutate: async () => ({}),
      getItem: async () => null,
      enrichForContext: async (i) => i,
      itemToContext: () => "stub",
    } satisfies Plugin
    expect(typeof full.query).toBe("function")
  })

  it("Scenario: `FieldDef` combines filter, badge, list-role, and detail-widget configs — dot-path id addresses nested fields", () => {
    const field = {
      id: "author.name",
      label: "Author",
      type: "text",
      filter: { filterable: true },
      badge: { show: "always" },
      listRole: "subtitle",
    } satisfies FieldDef
    expect(field.id).toBe("author.name")
    expect(field.listRole).toBe("subtitle")
    // listRole is one of the four documented roles.
    const roles: NonNullable<FieldDef["listRole"]>[] = ["title", "subtitle", "timestamp", "hidden"]
    expect(roles).toContain(field.listRole)
  })

  it("Scenario: `PluginContext` is request-scoped — carries userEmail and getCredential(integration)", async () => {
    const ctx: PluginContext = {
      userEmail: "alice@x.com",
      getCredential: async (integration) => (integration === "google" ? "tok" : null),
    }
    expect(ctx.userEmail).toBe("alice@x.com")
    expect(await ctx.getCredential("google")).toBe("tok")
    expect(await ctx.getCredential("slack")).toBeNull()
  })

  it("Scenario: `PluginComponents` declares string keys, not React components — JSON-serializable registry keys", () => {
    const components = { tab: "gmail:tab", list: "gmail:list", detail: "gmail:detail" } satisfies PluginComponents
    // All values are strings (registry keys), never React component refs.
    for (const v of Object.values(components)) expect(typeof v).toBe("string")
  })
})

describe("widget schema (src/types/panels.ts)", () => {
  it("Scenario: `WidgetDef` is a discriminated union by `type` — each entry matches a known discriminant and references data via field/fields", () => {
    const widgets: WidgetDef[] = [
      { type: "prose", field: "body" },
      { type: "kv-table", fields: ["title", "state"] },
      { type: "data-table", field: "rows" },
      { type: "badge-row", field: "labels" },
      { type: "json-tree", field: "raw" },
      { type: "action-buttons", actions: [{ label: "Close", mutation: "close" }] },
    ]
    const types = widgets.map((w) => w.type)
    expect(types).toEqual(["prose", "kv-table", "data-table", "badge-row", "json-tree", "action-buttons"])
    // Discriminant narrows the shape: prose has `field`, kv-table has `fields`.
    const prose = widgets[0]
    if (prose.type === "prose") expect(prose.field).toBe("body")
    const kv = widgets[1]
    if (kv.type === "kv-table") expect(kv.fields).toEqual(["title", "state"])
  })
})
