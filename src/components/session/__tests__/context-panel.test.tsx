// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { ContextPanel } from "../ContextPanel"
import type { InboxContextData } from "@/types"

// ContextPanel uses navigation actions for the "Open" button — stub them.
vi.mock("@/lib/navigation-store", () => ({
  useNavActions: () => ({ switchTab: vi.fn(), selectItem: vi.fn() }),
}))

function buildData(overrides: Partial<InboxContextData> = {}): InboxContextData {
  return {
    entity: {
      type: "person",
      name: "Caroline Tuerk",
      email: "caroline@incip.com",
      domain: "incip.com",
      company: "Incip",
      role: "Buyer",
    },
    source: { type: "gmail", id: "msg-1", threadId: "t-1", subject: "Order", from: "c", date: "2026-01-01", snippet: "hi" },
    contextPages: [{ file: "incip.md", title: "Incip", summary: "A wholesale buyer", tags: ["wholesale"] }],
    relatedThreads: [{ threadId: "t-2", subject: "Reorder", date: "2026-01-02", snippet: "more" }],
    relatedTasks: [{ id: "task-1", title: "Follow up", status: "open", url: "http://x" }],
    summary: "Caroline is a repeat wholesale buyer.",
    ...overrides,
  }
}

describe("ContextPanel", () => {
  it("Scenario: `ContextPanel` renders curated context for a focused entity — header, role+company, contextPages, relatedThreads, relatedTasks, and summary with accordions default-open", () => {
    render(<ContextPanel data={buildData()} />)

    // Entity header: name + role at company subtitle.
    expect(screen.getByText("Caroline Tuerk")).toBeTruthy()
    expect(screen.getByText("Buyer at Incip")).toBeTruthy()
    // Summary.
    expect(screen.getByText("Caroline is a repeat wholesale buyer.")).toBeTruthy()
    // Curated sections render with counts; non-empty accordions default-open.
    expect(screen.getByText("Context pages (1)")).toBeTruthy()
    expect(screen.getByText("Related threads (1)")).toBeTruthy()
    expect(screen.getByText("Related tasks (1)")).toBeTruthy()
    // Default-open content is visible.
    expect(screen.getByText("Incip")).toBeTruthy()
    expect(screen.getByText("Reorder")).toBeTruthy()
    expect(screen.getByText("Follow up")).toBeTruthy()
  })

  it("omits sections that have no items", () => {
    render(<ContextPanel data={buildData({ contextPages: [], relatedThreads: [], relatedTasks: [] })} />)
    expect(screen.queryByText(/Context pages/)).toBeNull()
    expect(screen.queryByText(/Related threads/)).toBeNull()
    expect(screen.queryByText(/Related tasks/)).toBeNull()
  })
})
