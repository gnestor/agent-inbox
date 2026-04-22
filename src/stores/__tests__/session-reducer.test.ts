// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import {
  reduceSnapshot,
  reduceEvent,
  reduceOptimisticPrompt,
  reduceClearPendingQuestion,
  type SessionSlice,
} from "../session-reducer"
import type { Session, SessionMessage } from "@/types"

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "s1",
    status: "running",
    prompt: "hi",
    summary: null,
    startedAt: "2026-04-22T00:00:00Z",
    updatedAt: "2026-04-22T00:00:00Z",
    completedAt: null,
    linkedSourceType: null,
    linkedSourceId: null,
    triggerSource: "manual",
    project: "demo",
    linkedItemTitle: null,
    ...overrides,
  }
}

function makeMsg(sequence: number, type: string, content: unknown = ""): SessionMessage {
  return {
    id: sequence,
    sessionId: "s1",
    sequence,
    type,
    message: type === "user"
      ? { type: "user", content: content as string } as any
      : { type: "assistant", content: content as any[] } as any,
    createdAt: "2026-04-22T00:00:00Z",
  }
}

describe("reduceSnapshot", () => {
  it("replaces session + messages wholesale", () => {
    const prev: SessionSlice = {
      session: makeSession({ status: "running" }),
      messageIds: [999],
      messageById: { 999: makeMsg(999, "assistant", [{ type: "text", text: "old" }]) },
      pendingPrompts: [],
      pendingQuestion: null,
      presence: [],
    }
    const next = reduceSnapshot(prev, {
      session: makeSession({ status: "complete" }),
      messages: [makeMsg(0, "user", "hi"), makeMsg(1, "assistant", [{ type: "text", text: "hello" }])],
    })
    expect(next.session.status).toBe("complete")
    expect(next.messageIds).toEqual([0, 1])
    expect(next.messageById[0]!.type).toBe("user")
    expect(next.messageById[999]).toBeUndefined()
  })

  it("sorts messageIds ascending regardless of input order", () => {
    const next = reduceSnapshot(undefined, {
      session: makeSession(),
      messages: [makeMsg(5, "assistant"), makeMsg(0, "user"), makeMsg(3, "assistant")],
    })
    expect(next.messageIds).toEqual([0, 3, 5])
  })

  it("preserves pendingQuestion and presence from previous slice", () => {
    const prev: SessionSlice = {
      session: makeSession(),
      messageIds: [],
      messageById: {},
      pendingPrompts: [],
      pendingQuestion: { questions: [{ question: "?", header: "Q", options: [], multiSelect: false }] },
      presence: [{ email: "a@b", name: "A" }],
    }
    const next = reduceSnapshot(prev, {
      session: makeSession(),
      messages: [],
    })
    expect(next.pendingQuestion).toBeTruthy()
    expect(next.presence).toHaveLength(1)
  })

  it("clears pending prompts whose text matches a hydrated user message", () => {
    const prev: SessionSlice = {
      session: makeSession(),
      messageIds: [],
      messageById: {},
      pendingPrompts: [
        { localId: "a", prompt: "hello server", createdAt: "t1" },
        { localId: "b", prompt: "still pending", createdAt: "t2" },
      ],
      pendingQuestion: null,
      presence: [],
    }
    const next = reduceSnapshot(prev, {
      session: makeSession(),
      messages: [makeMsg(0, "user", "hello server")],
    })
    expect(next.pendingPrompts.map((p) => p.localId)).toEqual(["b"])
  })
})

describe("reduceEvent (message events)", () => {
  const base: SessionSlice = {
    session: makeSession(),
    messageIds: [0],
    messageById: { 0: makeMsg(0, "user", "hi") },
    pendingPrompts: [],
    pendingQuestion: null,
    presence: [],
  }

  it("appends a new message in order", () => {
    const next = reduceEvent(base, {
      sequence: 1,
      message: { type: "assistant", content: [{ type: "text", text: "ok" }] },
    })
    expect(next.messageIds).toEqual([0, 1])
    expect(next.messageById[1]!.type).toBe("assistant")
  })

  it("is a no-op when sequence already exists", () => {
    const next = reduceEvent(base, {
      sequence: 0,
      message: { type: "user", content: "hi" },
    })
    expect(next).toBe(base)
  })

  it("inserts out-of-order events into sorted position", () => {
    const withTwo = reduceEvent(base, {
      sequence: 2,
      message: { type: "assistant", content: [] },
    })
    const withOne = reduceEvent(withTwo, {
      sequence: 1,
      message: { type: "assistant", content: [{ type: "text", text: "mid" }] },
    })
    expect(withOne.messageIds).toEqual([0, 1, 2])
  })

  it("clears matching optimistic prompts when the user echo arrives", () => {
    const slice: SessionSlice = {
      ...base,
      pendingPrompts: [{ localId: "a", prompt: "run this", createdAt: "t1" }],
    }
    const next = reduceEvent(slice, {
      sequence: 1,
      message: { type: "user", content: "run this" },
    })
    expect(next.pendingPrompts).toHaveLength(0)
  })

  it("does not clear non-matching optimistic prompts", () => {
    const slice: SessionSlice = {
      ...base,
      pendingPrompts: [{ localId: "a", prompt: "run this", createdAt: "t1" }],
    }
    const next = reduceEvent(slice, {
      sequence: 1,
      message: { type: "user", content: "something else" },
    })
    expect(next.pendingPrompts).toHaveLength(1)
  })
})

describe("reduceEvent (lifecycle events)", () => {
  const base: SessionSlice = {
    session: makeSession({ status: "running" }),
    messageIds: [],
    messageById: {},
    pendingPrompts: [],
    pendingQuestion: null,
    presence: [],
  }

  it("session_complete sets status complete", () => {
    const next = reduceEvent(base, { type: "session_complete" })
    expect(next.session.status).toBe("complete")
  })

  it("session_error sets status errored", () => {
    const next = reduceEvent(base, { type: "session_error" })
    expect(next.session.status).toBe("errored")
  })

  it("ask_user_question sets pendingQuestion and awaiting_user_input", () => {
    const next = reduceEvent(base, {
      type: "ask_user_question",
      questions: [{ question: "?", header: "Q", options: [], multiSelect: false }],
    })
    expect(next.pendingQuestion).toBeTruthy()
    expect(next.session.status).toBe("awaiting_user_input")
  })

  it("presence replaces the presence list", () => {
    const next = reduceEvent(base, {
      type: "presence",
      users: [{ email: "a@b", name: "A" }, { email: "c@d", name: "C" }],
    })
    expect(next.presence).toHaveLength(2)
  })
})

describe("reduceOptimisticPrompt", () => {
  it("appends a pending prompt and flips status to running", () => {
    const base: SessionSlice = {
      session: makeSession({ status: "complete" }),
      messageIds: [],
      messageById: {},
      pendingPrompts: [],
      pendingQuestion: null,
      presence: [],
    }
    const next = reduceOptimisticPrompt(base, "new prompt", "local-1")
    expect(next.pendingPrompts).toHaveLength(1)
    expect(next.pendingPrompts[0]!.prompt).toBe("new prompt")
    expect(next.session.status).toBe("running")
  })
})

describe("reduceClearPendingQuestion", () => {
  it("clears pendingQuestion without touching other fields", () => {
    const base: SessionSlice = {
      session: makeSession(),
      messageIds: [],
      messageById: {},
      pendingPrompts: [],
      pendingQuestion: { questions: [{ question: "?", header: "Q", options: [], multiSelect: false }] },
      presence: [],
    }
    const next = reduceClearPendingQuestion(base)
    expect(next.pendingQuestion).toBeNull()
  })
})

describe("snapshot + event idempotence", () => {
  it("snapshot then duplicate event = same content", () => {
    const a = reduceSnapshot(undefined, {
      session: makeSession(),
      messages: [makeMsg(0, "user", "hi"), makeMsg(1, "assistant", [{ type: "text", text: "ok" }])],
    })
    const b = reduceEvent(a, {
      sequence: 1,
      message: { type: "assistant", content: [{ type: "text", text: "ok" }] },
    })
    expect(b).toBe(a) // exact same reference: duplicate sequence is a no-op
  })
})
