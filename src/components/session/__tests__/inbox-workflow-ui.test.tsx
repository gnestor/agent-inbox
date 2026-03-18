// @vitest-environment jsdom
import "@testing-library/jest-dom"
import React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

// ── extractXmlTag ────────────────────────────────────────────────────────────

import { extractXmlTag } from "../SessionTranscript.js"

describe("extractXmlTag", () => {
  it("extracts content from a simple tag", () => {
    expect(extractXmlTag("<foo>hello</foo>", "foo")).toBe("hello")
  })

  it("trims whitespace from extracted content", () => {
    expect(extractXmlTag("<foo>  hello  </foo>", "foo")).toBe("hello")
  })

  it("extracts multiline content", () => {
    const text = "<inbox-context>\n{ \"key\": \"value\" }\n</inbox-context>"
    expect(extractXmlTag(text, "inbox-context")).toBe('{ "key": "value" }')
  })

  it("returns null when tag is not present", () => {
    expect(extractXmlTag("no tags here", "inbox-context")).toBeNull()
  })

  it("returns null when only opening tag is present", () => {
    expect(extractXmlTag("<foo>no closing", "foo")).toBeNull()
  })

  it("extracts content when surrounded by other text", () => {
    const text = "some text <foo>inner</foo> more text"
    expect(extractXmlTag(text, "foo")).toBe("inner")
  })

  it("extracts first match when tag appears multiple times", () => {
    expect(extractXmlTag("<foo>first</foo><foo>second</foo>", "foo")).toBe("first")
  })

  it("handles empty tag content", () => {
    expect(extractXmlTag("<foo></foo>", "foo")).toBe("")
  })
})

// ── InboxResultPanel ──────────────────────────────────────────────────────────

import { InboxResultPanel } from "../InboxResultPanel.js"
import * as client from "@/api/client"

vi.mock("@/api/client")

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe("InboxResultPanel — skipped", () => {
  it("renders summary text", () => {
    const data = { action: "skipped" as const, summary: "No action needed." }
    render(<InboxResultPanel data={data} sessionId="s1" />, {
      wrapper: makeWrapper(new QueryClient()),
    })
    expect(screen.getByText("No action needed.")).toBeInTheDocument()
  })

  it("renders nothing when no summary", () => {
    const data = { action: "skipped" as const, summary: "" }
    const { container } = render(<InboxResultPanel data={data} sessionId="s1" />, {
      wrapper: makeWrapper(new QueryClient()),
    })
    expect(container.firstChild).toBeNull()
  })
})

describe("InboxResultPanel — context_updated", () => {
  it("shows file paths", () => {
    const data = {
      action: "context_updated" as const,
      summary: "Updated context.",
      contextUpdated: ["context/alice.md", "context/acme.md"],
    }
    render(<InboxResultPanel data={data} sessionId="s1" />, {
      wrapper: makeWrapper(new QueryClient()),
    })
    expect(screen.getByText("Context updated")).toBeInTheDocument()
    expect(screen.getByText("context/alice.md")).toBeInTheDocument()
    expect(screen.getByText("context/acme.md")).toBeInTheDocument()
  })
})

describe("InboxResultPanel — task", () => {
  beforeEach(() => vi.resetAllMocks())

  it("renders task title and status badge", () => {
    const data = {
      action: "task" as const,
      summary: "Task ready.",
      task: { id: "t1", title: "Write proposal", status: "In Progress", url: "https://notion.so/t1" },
    }
    render(<InboxResultPanel data={data} sessionId="s1" />, {
      wrapper: makeWrapper(new QueryClient()),
    })
    expect(screen.getByText("Write proposal")).toBeInTheDocument()
    expect(screen.getByText("In Progress")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /open in notion/i })).toHaveAttribute("href", "https://notion.so/t1")
  })

  it("calls updateTask and shows success state on Mark Complete", async () => {
    vi.mocked(client.updateTask).mockResolvedValueOnce(undefined as any)

    const data = {
      action: "task" as const,
      summary: "",
      task: { id: "t1", title: "Write proposal", status: "In Progress", url: "https://notion.so/t1" },
    }
    const qc = new QueryClient()
    render(<InboxResultPanel data={data} sessionId="s1" />, { wrapper: makeWrapper(qc) })

    fireEvent.click(screen.getByRole("button", { name: /mark complete/i }))

    await waitFor(() => expect(screen.getByText(/marked as complete/i)).toBeInTheDocument())
    expect(client.updateTask).toHaveBeenCalledWith("t1", { Status: { status: { name: "Done" } } })
  })

  it("shows error message when updateTask fails", async () => {
    vi.mocked(client.updateTask).mockRejectedValueOnce(new Error("API error"))

    const data = {
      action: "task" as const,
      summary: "",
      task: { id: "t1", title: "Write proposal", status: "In Progress", url: "https://notion.so/t1" },
    }
    render(<InboxResultPanel data={data} sessionId="s1" />, {
      wrapper: makeWrapper(new QueryClient()),
    })

    fireEvent.click(screen.getByRole("button", { name: /mark complete/i }))

    await waitFor(() => expect(screen.getByText(/failed to update task/i)).toBeInTheDocument())
  })
})

describe("InboxResultPanel — draft", () => {
  beforeEach(() => vi.resetAllMocks())

  it("renders draft fields (to, subject) and Save Draft button", () => {
    const data = {
      action: "draft" as const,
      summary: "",
      draft: {
        to: "alice@example.com",
        subject: "Re: Meeting",
        body: "Hello Alice,\n\nSounds good!",
        threadId: "thread-1",
        inReplyTo: null,
      },
    }
    render(<InboxResultPanel data={data} sessionId="s1" />, {
      wrapper: makeWrapper(new QueryClient()),
    })
    expect(screen.getByText("alice@example.com")).toBeInTheDocument()
    expect(screen.getByText("Re: Meeting")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /save draft/i })).toBeInTheDocument()
  })

  it("calls createDraft and shows success state on Save Draft", async () => {
    vi.mocked(client.createDraft).mockResolvedValueOnce(undefined as any)

    const data = {
      action: "draft" as const,
      summary: "",
      draft: {
        to: "alice@example.com",
        subject: "Re: Meeting",
        body: "Hello Alice",
        threadId: "thread-1",
        inReplyTo: "msg-1",
      },
    }
    render(<InboxResultPanel data={data} sessionId="s1" />, {
      wrapper: makeWrapper(new QueryClient()),
    })

    fireEvent.click(screen.getByRole("button", { name: /save draft/i }))

    await waitFor(() => expect(screen.getByText(/draft saved/i)).toBeInTheDocument())
    expect(client.createDraft).toHaveBeenCalledWith({
      to: "alice@example.com",
      subject: "Re: Meeting",
      body: "Hello Alice",
      threadId: "thread-1",
      inReplyTo: "msg-1",
    })
  })

  it("shows error message when createDraft fails", async () => {
    vi.mocked(client.createDraft).mockRejectedValueOnce(new Error("Network error"))

    const data = {
      action: "draft" as const,
      summary: "",
      draft: {
        to: "bob@example.com",
        subject: "Hi",
        body: "Hello",
        threadId: null,
        inReplyTo: null,
      },
    }
    render(<InboxResultPanel data={data} sessionId="s1" />, {
      wrapper: makeWrapper(new QueryClient()),
    })

    fireEvent.click(screen.getByRole("button", { name: /save draft/i }))

    await waitFor(() => expect(screen.getByText(/failed to save draft/i)).toBeInTheDocument())
  })
})

// ── ContextPanel ─────────────────────────────────────────────────────────────

import { ContextPanel } from "../ContextPanel.js"

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock("@/hooks/use-navigation", () => ({
  useNavigation: () => ({
    switchTab: vi.fn(),
    selectItem: vi.fn(),
    pushPanel: vi.fn(),
    popPanel: vi.fn(),
    replacePanel: vi.fn(),
    state: { activeTab: "sessions", tabs: {} },
  }),
}))

function makeContextData(overrides: Partial<Parameters<typeof ContextPanel>[0]["data"]> = {}) {
  return {
    entity: {
      type: "person" as const,
      name: "Alice Smith",
      email: "alice@example.com",
      domain: null,
      company: "Acme Corp",
      role: "CEO",
    },
    source: {
      type: "email" as const,
      id: "msg-1",
      threadId: "thread-1",
      subject: "Re: Proposal",
      from: "alice@example.com",
      date: "2024-01-01T00:00:00Z",
      snippet: "Sounds good!",
    },
    contextPages: [],
    relatedThreads: [],
    relatedTasks: [],
    summary: "Alice is the CEO of Acme Corp.",
    ...overrides,
  }
}

describe("ContextPanel", () => {
  it("renders entity name and subtitle", () => {
    render(<ContextPanel data={makeContextData()} />)
    expect(screen.getByText("Alice Smith")).toBeInTheDocument()
    expect(screen.getByText("CEO at Acme Corp")).toBeInTheDocument()
  })

  it("renders summary", () => {
    render(<ContextPanel data={makeContextData()} />)
    expect(screen.getByText("Alice is the CEO of Acme Corp.")).toBeInTheDocument()
  })

  it("shows context pages with title and tags", () => {
    const data = makeContextData({
      contextPages: [
        {
          file: "context/alice.md",
          title: "Alice Smith",
          summary: "Notes on Alice",
          tags: ["lead", "enterprise"],
        },
      ],
    })
    render(<ContextPanel data={data} />)
    expect(screen.getByText("context/alice.md")).toBeInTheDocument()
    // "Alice Smith" appears in entity header + page title
    expect(screen.getAllByText("Alice Smith").length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText("lead")).toBeInTheDocument()
    expect(screen.getByText("enterprise")).toBeInTheDocument()
  })

  it("shows related threads with subject", () => {
    const data = makeContextData({
      relatedThreads: [
        {
          threadId: "t2",
          subject: "Q4 Budget Review",
          date: "2024-01-01T00:00:00Z",
          snippet: "Please review...",
        },
      ],
    })
    render(<ContextPanel data={data} />)
    expect(screen.getByText("Q4 Budget Review")).toBeInTheDocument()
  })

  it("shows related tasks with title and status badge", () => {
    const data = makeContextData({
      relatedTasks: [
        {
          id: "task-1",
          title: "Follow up with Alice",
          status: "In Progress",
          url: "https://notion.so/task-1",
        },
      ],
    })
    render(<ContextPanel data={data} />)
    expect(screen.getByText("Follow up with Alice")).toBeInTheDocument()
    expect(screen.getByText("In Progress")).toBeInTheDocument()
  })

  it("uses email fallback as subtitle when no role/company", () => {
    const data = makeContextData({
      entity: {
        type: "person" as const,
        name: "Bob",
        email: "bob@example.com",
        domain: null,
        company: null,
        role: null,
      },
    })
    render(<ContextPanel data={data} />)
    expect(screen.getByText("bob@example.com")).toBeInTheDocument()
  })

  it("renders nothing for accordion sections when arrays are empty", () => {
    const { container } = render(<ContextPanel data={makeContextData()} />)
    expect(container.querySelector("[data-slot='accordion']")).toBeNull()
  })
})
