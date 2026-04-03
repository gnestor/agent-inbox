import { describe, it, expect } from "vitest"
import {
  buildLookups,
  classifyMessage,
  isVisible,
  filterVisible,
  processTranscript,
  extractText,
  extractXmlTag,
  extractSkillBlock,
  parseIdeContext,
  groupContentBlocks,
  toolUseSummary,
  toolUseCommand,
  getContentBlocks,
} from "../session-pipeline"
import type { SessionMessage } from "@/types"
import type { TranscriptVisibility } from "../session-pipeline"

function msg(overrides: Partial<SessionMessage> & { message: any }): SessionMessage {
  return {
    id: 1,
    sessionId: "s1",
    sequence: 1,
    type: overrides.message.type || "unknown",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  }
}

const ALL_VISIBLE: TranscriptVisibility = {
  messages: true,
  toolCalls: true,
  thinking: true,
  artifacts: true,
}

// ---------------------------------------------------------------------------
// buildLookups
// ---------------------------------------------------------------------------

describe("buildLookups", () => {
  it("extracts tool results from tool_result content blocks", () => {
    const messages: SessionMessage[] = [
      msg({
        sequence: 1,
        message: {
          type: "user",
          content: [
            { type: "tool_result", tool_use_id: "t1", content: "file contents" },
          ],
        },
      }),
    ]
    const lookups = buildLookups(messages)
    expect(lookups.toolResults.get("t1")).toBe("file contents")
    expect(lookups.resolvedToolUseIDs.has("t1")).toBe(true)
  })

  it("collects author emails", () => {
    const messages: SessionMessage[] = [
      msg({ sequence: 1, message: { type: "user", content: "hi", authorEmail: "alice@test.com" } }),
      msg({ sequence: 2, message: { type: "user", content: "yo", authorEmail: "bob@test.com" } }),
      msg({ sequence: 3, message: { type: "user", content: "again", authorEmail: "alice@test.com" } }),
    ]
    const lookups = buildLookups(messages)
    expect(lookups.authorEmails).toEqual(["alice@test.com", "bob@test.com"])
  })

  it("handles nested message.content path", () => {
    const messages: SessionMessage[] = [
      msg({
        sequence: 1,
        message: {
          type: "user",
          message: {
            content: [
              { type: "tool_result", tool_use_id: "t2", content: "nested result" },
            ],
          },
        },
      }),
    ]
    const lookups = buildLookups(messages)
    expect(lookups.toolResults.get("t2")).toBe("nested result")
  })
})

// ---------------------------------------------------------------------------
// classifyMessage
// ---------------------------------------------------------------------------

describe("classifyMessage", () => {
  it("classifies system init as system_init", () => {
    const cm = classifyMessage(msg({ message: { type: "system", subtype: "init" } }))
    expect(cm.displayType).toBe("system_init")
  })

  it("classifies system result", () => {
    const cm = classifyMessage(msg({ message: { type: "system", subtype: "result", result: "Done" } }))
    expect(cm.displayType).toBe("system_result")
    expect(cm.text).toBe("Done")
  })

  it("classifies normal user message", () => {
    const cm = classifyMessage(msg({ message: { type: "user", content: "Hello" } }))
    expect(cm.displayType).toBe("user_message")
    expect(cm.text).toBe("Hello")
  })

  it("classifies artifact action", () => {
    const cm = classifyMessage(msg({
      message: { type: "user", content: '<artifact_action intent="submit">{"key":"val"}</artifact_action>' },
    }))
    expect(cm.displayType).toBe("user_artifact_action")
    expect(cm.artifactAction?.intent).toBe("submit")
  })

  it("classifies skill block", () => {
    const cm = classifyMessage(msg({
      message: {
        type: "user",
        content: [{ type: "text", text: "Base directory for this skill: /path/to/my-skill\nSkill content here" }],
      },
    }))
    expect(cm.displayType).toBe("user_skill")
    expect(cm.skillBlock?.name).toBe("my-skill")
    expect(cm.skillBlock?.content).toBe("Skill content here")
  })

  it("classifies assistant with content blocks", () => {
    const cm = classifyMessage(msg({
      message: {
        type: "assistant",
        content: [
          { type: "text", text: "Here's what I found" },
          { type: "tool_use", id: "t1", name: "Read", input: { file_path: "foo.ts" } },
        ],
      },
    }))
    expect(cm.displayType).toBe("assistant_blocks")
    expect(cm.groupedBlocks).not.toBeNull()
  })

  it("classifies assistant with no content blocks as text only", () => {
    const cm = classifyMessage(msg({
      message: { type: "assistant", content: "Just text" },
    }))
    expect(cm.displayType).toBe("assistant_text_only")
    expect(cm.text).toBe("Just text")
  })

  it("classifies plan messages", () => {
    const cm = classifyMessage(msg({ message: { type: "plan", content: "# My Plan" } }))
    expect(cm.displayType).toBe("plan")
    expect(cm.text).toBe("# My Plan")
  })

  it("classifies tool_result as tool_result (hidden)", () => {
    const cm = classifyMessage(msg({ message: { type: "tool_result" } }))
    expect(cm.displayType).toBe("tool_result")
  })

  it("marks synthetic messages as hidden", () => {
    const cm = classifyMessage(msg({ message: { type: "user", content: "auto", isSynthetic: true } }))
    expect(cm.displayType).toBe("hidden")
  })
})

// ---------------------------------------------------------------------------
// isVisible + filterVisible
// ---------------------------------------------------------------------------

describe("isVisible", () => {
  it("hides system_init always", () => {
    const cm = classifyMessage(msg({ message: { type: "system", subtype: "init" } }))
    expect(isVisible(cm, ALL_VISIBLE)).toBe(false)
  })

  it("shows user messages when messages visible", () => {
    const cm = classifyMessage(msg({ message: { type: "user", content: "hi" } }))
    expect(isVisible(cm, ALL_VISIBLE)).toBe(true)
    expect(isVisible(cm, { ...ALL_VISIBLE, messages: false })).toBe(false)
  })

  it("hides empty user messages", () => {
    const cm = classifyMessage(msg({ message: { type: "user", content: "" } }))
    expect(isVisible(cm, ALL_VISIBLE)).toBe(false)
  })

  it("always shows user_skill and user_artifact_action", () => {
    const skill = classifyMessage(msg({
      message: { type: "user", content: [{ type: "text", text: "Base directory for this skill: /x/y\ncontent" }] },
    }))
    expect(isVisible(skill, { ...ALL_VISIBLE, messages: false })).toBe(true)
  })
})

describe("filterVisible", () => {
  it("filters based on visibility", () => {
    const messages = [
      msg({ sequence: 1, message: { type: "system", subtype: "init" } }),
      msg({ sequence: 2, message: { type: "user", content: "Hello" } }),
      msg({ sequence: 3, message: { type: "assistant", content: "Hi" } }),
    ]
    const { classified } = processTranscript(messages)
    const visible = filterVisible(classified, ALL_VISIBLE)
    expect(visible.length).toBe(2) // init is hidden
    expect(visible[0].displayType).toBe("user_message")
    expect(visible[1].displayType).toBe("assistant_text_only")
  })
})

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

describe("extractText", () => {
  it("extracts from string content", () => {
    expect(extractText({ type: "user", content: "hello" } as any)).toBe("hello")
  })

  it("extracts from content block array", () => {
    expect(extractText({
      type: "assistant",
      content: [{ type: "text", text: "foo" }, { type: "text", text: "bar" }],
    } as any)).toBe("foo\nbar")
  })

  it("strips IDE context tags", () => {
    const result = extractText({
      type: "user",
      content: [{ type: "text", text: "<ide_opened_file>The user opened the file foo.ts in the IDE</ide_opened_file>\nActual prompt" }],
    } as any)
    expect(result).toBe("Actual prompt")
  })
})

describe("extractXmlTag", () => {
  it("extracts tag content", () => {
    expect(extractXmlTag("<foo>bar</foo>", "foo")).toBe("bar")
  })

  it("returns null for missing tag", () => {
    expect(extractXmlTag("no tag here", "foo")).toBeNull()
  })
})

describe("groupContentBlocks", () => {
  it("groups consecutive tool_use blocks", () => {
    const blocks: any[] = [
      { type: "text", text: "hello" },
      { type: "tool_use", id: "1", name: "Read", input: {} },
      { type: "tool_use", id: "2", name: "Grep", input: {} },
      { type: "text", text: "bye" },
    ]
    const groups = groupContentBlocks(blocks)
    expect(groups.length).toBe(3)
    expect(Array.isArray(groups[1])).toBe(true)
    expect((groups[1] as any[]).length).toBe(2)
  })

  it("keeps render_output separate", () => {
    const blocks: any[] = [
      { type: "tool_use", id: "1", name: "Read", input: {} },
      { type: "tool_use", id: "2", name: "render_output", input: {} },
      { type: "tool_use", id: "3", name: "Grep", input: {} },
    ]
    const groups = groupContentBlocks(blocks)
    // Read is grouped alone, render_output is separate, Grep is grouped alone
    expect(groups.length).toBe(3)
  })
})

describe("toolUseSummary", () => {
  it("returns file_path for Read", () => {
    expect(toolUseSummary("Read", { file_path: "/foo/bar.ts" })).toBe("/foo/bar.ts")
  })

  it("returns description for Bash", () => {
    expect(toolUseSummary("Bash", { description: "list files", command: "ls -la" })).toBe("list files")
  })

  it("falls back to command for Bash without description", () => {
    expect(toolUseSummary("Bash", { command: "ls -la" })).toBe("ls -la")
  })
})

describe("toolUseCommand", () => {
  it("returns command for Bash", () => {
    expect(toolUseCommand("Bash", { command: "npm test" })).toBe("npm test")
  })

  it("returns file_path for Read", () => {
    expect(toolUseCommand("Read", { file_path: "/x.ts" })).toBe("/x.ts")
  })
})

describe("processTranscript", () => {
  it("returns lookups and classified messages", () => {
    const messages = [
      msg({ sequence: 1, message: { type: "user", content: "hi" } }),
      msg({ sequence: 2, message: { type: "assistant", content: "hello" } }),
    ]
    const result = processTranscript(messages)
    expect(result.lookups).toBeDefined()
    expect(result.classified.length).toBe(2)
  })
})
