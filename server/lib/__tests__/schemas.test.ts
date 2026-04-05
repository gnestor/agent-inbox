import { describe, it, expect } from "vitest"
import {
  CreateSessionBody,
  ResumeSessionBody,
  UpdateSessionBody,
  AnswerSessionBody,
  AttachToSessionBody,
  PatchArtifactBody,
  PluginMutateBody,
  AuthCallbackBody,
  SetPreferenceBody,
  AddWorkspaceMemberBody,
  RenameWorkspaceBody,
  SetActiveWorkspaceBody,
  SessionRow,
  WorkspaceRow,
  UserRow,
  parseBody,
} from "../schemas.js"
import { z } from "zod/v4"

// ---------------------------------------------------------------------------
// CreateSessionBody
// ---------------------------------------------------------------------------

describe("CreateSessionBody", () => {
  it("accepts valid body with only prompt", () => {
    const result = CreateSessionBody.safeParse({ prompt: "hello" })
    expect(result.success).toBe(true)
  })

  it("rejects empty prompt", () => {
    const result = CreateSessionBody.safeParse({ prompt: "" })
    expect(result.success).toBe(false)
  })

  it("rejects missing prompt", () => {
    const result = CreateSessionBody.safeParse({})
    expect(result.success).toBe(false)
  })

  it("rejects non-string prompt", () => {
    const result = CreateSessionBody.safeParse({ prompt: 123 })
    expect(result.success).toBe(false)
  })

  it("accepts all optional fields", () => {
    const result = CreateSessionBody.safeParse({
      prompt: "hello",
      linkedSourceType: "email",
      linkedSourceId: "123",
      linkedSourceContent: "some content",
      linkedItemTitle: "My Email",
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.linkedSourceType).toBe("email")
      expect(result.data.linkedSourceId).toBe("123")
      expect(result.data.linkedSourceContent).toBe("some content")
      expect(result.data.linkedItemTitle).toBe("My Email")
    }
  })

  it("strips unknown fields", () => {
    const result = CreateSessionBody.safeParse({
      prompt: "hello",
      unknown: "field",
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect((result.data as Record<string, unknown>).unknown).toBeUndefined()
    }
  })
})

// ---------------------------------------------------------------------------
// ResumeSessionBody
// ---------------------------------------------------------------------------

describe("ResumeSessionBody", () => {
  it("accepts valid body", () => {
    const result = ResumeSessionBody.safeParse({ prompt: "continue" })
    expect(result.success).toBe(true)
  })

  it("rejects empty prompt", () => {
    const result = ResumeSessionBody.safeParse({ prompt: "" })
    expect(result.success).toBe(false)
  })

  it("rejects missing prompt", () => {
    const result = ResumeSessionBody.safeParse({})
    expect(result.success).toBe(false)
  })

  it("rejects non-string prompt", () => {
    const result = ResumeSessionBody.safeParse({ prompt: true })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// UpdateSessionBody
// ---------------------------------------------------------------------------

describe("UpdateSessionBody", () => {
  it("accepts valid summary", () => {
    const result = UpdateSessionBody.safeParse({ summary: "done" })
    expect(result.success).toBe(true)
  })

  it("accepts empty string summary (no min constraint)", () => {
    const result = UpdateSessionBody.safeParse({ summary: "" })
    expect(result.success).toBe(true)
  })

  it("rejects missing summary", () => {
    const result = UpdateSessionBody.safeParse({})
    expect(result.success).toBe(false)
  })

  it("rejects non-string summary", () => {
    const result = UpdateSessionBody.safeParse({ summary: 42 })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// AnswerSessionBody
// ---------------------------------------------------------------------------

describe("AnswerSessionBody", () => {
  it("accepts valid answers record", () => {
    const result = AnswerSessionBody.safeParse({
      answers: { q1: "yes", q2: "no" },
    })
    expect(result.success).toBe(true)
  })

  it("accepts empty answers record", () => {
    const result = AnswerSessionBody.safeParse({ answers: {} })
    expect(result.success).toBe(true)
  })

  it("rejects missing answers", () => {
    const result = AnswerSessionBody.safeParse({})
    expect(result.success).toBe(false)
  })

  it("rejects non-string values in record", () => {
    const result = AnswerSessionBody.safeParse({
      answers: { q1: 123 },
    })
    expect(result.success).toBe(false)
  })

  it("rejects non-object answers", () => {
    const result = AnswerSessionBody.safeParse({ answers: "yes" })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// AttachToSessionBody
// ---------------------------------------------------------------------------

describe("AttachToSessionBody", () => {
  it("accepts valid body", () => {
    const result = AttachToSessionBody.safeParse({
      type: "email",
      id: "msg-123",
      content: "email body here",
    })
    expect(result.success).toBe(true)
  })

  it("accepts optional title", () => {
    const result = AttachToSessionBody.safeParse({
      type: "email",
      id: "msg-123",
      content: "email body here",
      title: "Subject Line",
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.title).toBe("Subject Line")
    }
  })

  it("rejects empty type", () => {
    const result = AttachToSessionBody.safeParse({
      type: "",
      id: "msg-123",
      content: "body",
    })
    expect(result.success).toBe(false)
  })

  it("rejects empty id", () => {
    const result = AttachToSessionBody.safeParse({
      type: "email",
      id: "",
      content: "body",
    })
    expect(result.success).toBe(false)
  })

  it("rejects empty content", () => {
    const result = AttachToSessionBody.safeParse({
      type: "email",
      id: "msg-123",
      content: "",
    })
    expect(result.success).toBe(false)
  })

  it("rejects missing required fields", () => {
    expect(AttachToSessionBody.safeParse({}).success).toBe(false)
    expect(AttachToSessionBody.safeParse({ type: "email" }).success).toBe(false)
    expect(
      AttachToSessionBody.safeParse({ type: "email", id: "123" }).success
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// PatchArtifactBody
// ---------------------------------------------------------------------------

describe("PatchArtifactBody", () => {
  it("accepts valid body", () => {
    const result = PatchArtifactBody.safeParse({
      sequence: 1,
      code: "console.log('hi')",
    })
    expect(result.success).toBe(true)
  })

  it("accepts empty code string (no min constraint)", () => {
    const result = PatchArtifactBody.safeParse({ sequence: 0, code: "" })
    expect(result.success).toBe(true)
  })

  it("rejects non-integer sequence", () => {
    const result = PatchArtifactBody.safeParse({ sequence: 1.5, code: "x" })
    expect(result.success).toBe(false)
  })

  it("rejects string sequence", () => {
    const result = PatchArtifactBody.safeParse({ sequence: "1", code: "x" })
    expect(result.success).toBe(false)
  })

  it("rejects missing fields", () => {
    expect(PatchArtifactBody.safeParse({}).success).toBe(false)
    expect(PatchArtifactBody.safeParse({ sequence: 1 }).success).toBe(false)
    expect(PatchArtifactBody.safeParse({ code: "x" }).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// PluginMutateBody
// ---------------------------------------------------------------------------

describe("PluginMutateBody", () => {
  it("accepts valid body with action only", () => {
    const result = PluginMutateBody.safeParse({ action: "refresh" })
    expect(result.success).toBe(true)
  })

  it("accepts action with arbitrary payload", () => {
    const result = PluginMutateBody.safeParse({
      action: "update",
      payload: { key: "value", nested: [1, 2] },
    })
    expect(result.success).toBe(true)
  })

  it("rejects empty action", () => {
    const result = PluginMutateBody.safeParse({ action: "" })
    expect(result.success).toBe(false)
  })

  it("rejects missing action", () => {
    const result = PluginMutateBody.safeParse({})
    expect(result.success).toBe(false)
  })

  it("rejects non-string action", () => {
    const result = PluginMutateBody.safeParse({ action: 42 })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// AuthCallbackBody
// ---------------------------------------------------------------------------

describe("AuthCallbackBody", () => {
  it("accepts valid credential", () => {
    const result = AuthCallbackBody.safeParse({ credential: "token-abc" })
    expect(result.success).toBe(true)
  })

  it("rejects empty credential", () => {
    const result = AuthCallbackBody.safeParse({ credential: "" })
    expect(result.success).toBe(false)
  })

  it("rejects missing credential", () => {
    const result = AuthCallbackBody.safeParse({})
    expect(result.success).toBe(false)
  })

  it("rejects non-string credential", () => {
    const result = AuthCallbackBody.safeParse({ credential: 123 })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// SetPreferenceBody
// ---------------------------------------------------------------------------

describe("SetPreferenceBody", () => {
  it("accepts string value", () => {
    const result = SetPreferenceBody.safeParse({ key: "theme", value: "dark" })
    expect(result.success).toBe(true)
  })

  it("accepts number value", () => {
    const result = SetPreferenceBody.safeParse({ key: "fontSize", value: 14 })
    expect(result.success).toBe(true)
  })

  it("accepts boolean value", () => {
    const result = SetPreferenceBody.safeParse({
      key: "notifications",
      value: true,
    })
    expect(result.success).toBe(true)
  })

  it("accepts null value", () => {
    const result = SetPreferenceBody.safeParse({ key: "theme", value: null })
    expect(result.success).toBe(true)
  })

  it("rejects empty key", () => {
    const result = SetPreferenceBody.safeParse({ key: "", value: "dark" })
    expect(result.success).toBe(false)
  })

  it("rejects missing key", () => {
    const result = SetPreferenceBody.safeParse({ value: "dark" })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// AddWorkspaceMemberBody
// ---------------------------------------------------------------------------

describe("AddWorkspaceMemberBody", () => {
  it("accepts valid email without role", () => {
    const result = AddWorkspaceMemberBody.safeParse({
      email: "user@example.com",
    })
    expect(result.success).toBe(true)
  })

  it("accepts valid email with admin role", () => {
    const result = AddWorkspaceMemberBody.safeParse({
      email: "user@example.com",
      role: "admin",
    })
    expect(result.success).toBe(true)
  })

  it("accepts valid email with member role", () => {
    const result = AddWorkspaceMemberBody.safeParse({
      email: "user@example.com",
      role: "member",
    })
    expect(result.success).toBe(true)
  })

  it("rejects invalid email", () => {
    const result = AddWorkspaceMemberBody.safeParse({ email: "not-an-email" })
    expect(result.success).toBe(false)
  })

  it("rejects empty email", () => {
    const result = AddWorkspaceMemberBody.safeParse({ email: "" })
    expect(result.success).toBe(false)
  })

  it("rejects missing email", () => {
    const result = AddWorkspaceMemberBody.safeParse({})
    expect(result.success).toBe(false)
  })

  it("rejects invalid role", () => {
    const result = AddWorkspaceMemberBody.safeParse({
      email: "user@example.com",
      role: "owner",
    })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// RenameWorkspaceBody
// ---------------------------------------------------------------------------

describe("RenameWorkspaceBody", () => {
  it("accepts valid name", () => {
    const result = RenameWorkspaceBody.safeParse({ name: "My Workspace" })
    expect(result.success).toBe(true)
  })

  it("rejects empty name", () => {
    const result = RenameWorkspaceBody.safeParse({ name: "" })
    expect(result.success).toBe(false)
  })

  it("rejects missing name", () => {
    const result = RenameWorkspaceBody.safeParse({})
    expect(result.success).toBe(false)
  })

  it("rejects non-string name", () => {
    const result = RenameWorkspaceBody.safeParse({ name: 42 })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// SetActiveWorkspaceBody
// ---------------------------------------------------------------------------

describe("SetActiveWorkspaceBody", () => {
  it("accepts valid workspaceId", () => {
    const result = SetActiveWorkspaceBody.safeParse({
      workspaceId: "ws-123",
    })
    expect(result.success).toBe(true)
  })

  it("rejects empty workspaceId", () => {
    const result = SetActiveWorkspaceBody.safeParse({ workspaceId: "" })
    expect(result.success).toBe(false)
  })

  it("rejects missing workspaceId", () => {
    const result = SetActiveWorkspaceBody.safeParse({})
    expect(result.success).toBe(false)
  })

  it("rejects non-string workspaceId", () => {
    const result = SetActiveWorkspaceBody.safeParse({ workspaceId: 123 })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// SessionRow
// ---------------------------------------------------------------------------

describe("SessionRow", () => {
  const validRow = {
    id: "sess-1",
    status: "running",
    prompt: "do something",
    summary: null,
    started_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    completed_at: null,
    linked_source_type: null,
    linked_source_id: null,
    trigger_source: "user",
    linked_item_title: null,
  }

  it("accepts valid row with nulls", () => {
    const result = SessionRow.safeParse(validRow)
    expect(result.success).toBe(true)
  })

  it("accepts valid row with all fields populated", () => {
    const result = SessionRow.safeParse({
      ...validRow,
      summary: "completed task",
      completed_at: "2024-01-01T01:00:00Z",
      linked_source_type: "email",
      linked_source_id: "msg-1",
      linked_item_title: "My Email Subject",
    })
    expect(result.success).toBe(true)
  })

  it("rejects missing required fields", () => {
    expect(SessionRow.safeParse({}).success).toBe(false)
    const { id, ...noId } = validRow
    expect(SessionRow.safeParse(noId).success).toBe(false)
  })

  it("rejects wrong type for id", () => {
    const result = SessionRow.safeParse({ ...validRow, id: 123 })
    expect(result.success).toBe(false)
  })

  it("rejects non-nullable field set to null", () => {
    const result = SessionRow.safeParse({ ...validRow, status: null })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// WorkspaceRow
// ---------------------------------------------------------------------------

describe("WorkspaceRow", () => {
  const validRow = {
    id: "ws-1",
    name: "My Workspace",
    path: "/home/user/workspace",
    created_at: "2024-01-01T00:00:00Z",
  }

  it("accepts valid row", () => {
    const result = WorkspaceRow.safeParse(validRow)
    expect(result.success).toBe(true)
  })

  it("rejects missing required fields", () => {
    expect(WorkspaceRow.safeParse({}).success).toBe(false)
    const { name, ...noName } = validRow
    expect(WorkspaceRow.safeParse(noName).success).toBe(false)
  })

  it("rejects wrong types", () => {
    expect(
      WorkspaceRow.safeParse({ ...validRow, id: 123 }).success
    ).toBe(false)
    expect(
      WorkspaceRow.safeParse({ ...validRow, name: null }).success
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// UserRow
// ---------------------------------------------------------------------------

describe("UserRow", () => {
  it("accepts valid row with picture", () => {
    const result = UserRow.safeParse({
      email: "user@example.com",
      name: "Alice",
      picture: "https://example.com/avatar.png",
    })
    expect(result.success).toBe(true)
  })

  it("accepts valid row with null picture", () => {
    const result = UserRow.safeParse({
      email: "user@example.com",
      name: "Alice",
      picture: null,
    })
    expect(result.success).toBe(true)
  })

  it("rejects missing required fields", () => {
    expect(UserRow.safeParse({}).success).toBe(false)
    expect(UserRow.safeParse({ email: "a@b.com" }).success).toBe(false)
  })

  it("rejects wrong types", () => {
    expect(
      UserRow.safeParse({ email: 123, name: "Alice", picture: null }).success
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// parseBody helper
// ---------------------------------------------------------------------------

describe("parseBody", () => {
  it("returns parsed data for valid input", () => {
    const result = parseBody(ResumeSessionBody, { prompt: "go" })
    expect(result).toEqual({ prompt: "go" })
  })

  it("throws ZodError for invalid input", () => {
    expect(() => parseBody(ResumeSessionBody, {})).toThrow()
  })
})
