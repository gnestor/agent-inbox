// Pure reducers for session transcript state.
//
// No React, no store, no network. Every write to a SessionSlice goes through
// one of these functions. Tests can exercise them directly.

import type { Session, SessionMessage, PendingQuestion, PresenceUser } from "@/types"
import { normalizeMessagePayload, getMessageType } from "@/types/session-message"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PendingPrompt {
  localId: string
  prompt: string
  createdAt: string
}

export interface SessionSlice {
  session: Session
  /** sequence numbers in ascending order */
  messageIds: number[]
  /** normalised: sequence -> SessionMessage */
  messageById: Record<number, SessionMessage>
  pendingPrompts: PendingPrompt[]
  pendingQuestion: PendingQuestion | null
  presence: PresenceUser[]
}

// Server event shapes (mirrors what `broadcastToSession` emits on the wire)
export type ServerEvent =
  | { type: "session_complete"; status?: string }
  | { type: "session_error"; error?: string; status?: string }
  | { type: "ask_user_question"; questions: import("@/types").AskUserQuestion[] }
  | { type: "presence"; users: PresenceUser[] }
  | MessageEvent

export interface MessageEvent {
  sequence: number
  message: unknown
  // `type` / other fields may also be present but aren't used here
}

export function isMessageEvent(event: ServerEvent): event is MessageEvent {
  return "sequence" in event && "message" in event
}

// ---------------------------------------------------------------------------
// Snapshot reducer — wholesale replace from REST
// ---------------------------------------------------------------------------

export function reduceSnapshot(
  prev: SessionSlice | undefined,
  snapshot: { session: Session; messages: SessionMessage[] },
): SessionSlice {
  const messageById: Record<number, SessionMessage> = {}
  const messageIds: number[] = []
  for (const raw of snapshot.messages) {
    const msg: SessionMessage = {
      ...raw,
      message: normalizeMessagePayload(raw.message),
    }
    messageById[msg.sequence] = msg
    messageIds.push(msg.sequence)
  }
  messageIds.sort((a, b) => a - b)

  // Drop optimistic prompts that the server has echoed.
  const remainingPending = reconcilePendingPrompts(prev?.pendingPrompts ?? [], messageById)

  // Preserve pendingQuestion and presence if they came from live events — snapshot
  // doesn't include them. The coordinator will fire them again via wsSubscribe
  // replay on resubscribe, so it's fine if we briefly lose them mid-snapshot.
  return {
    session: snapshot.session,
    messageIds,
    messageById,
    pendingPrompts: remainingPending,
    pendingQuestion: prev?.pendingQuestion ?? null,
    presence: prev?.presence ?? [],
  }
}

// ---------------------------------------------------------------------------
// Event reducer — apply one live WS event
// ---------------------------------------------------------------------------

export function reduceEvent(slice: SessionSlice, event: ServerEvent): SessionSlice {
  if (isMessageEvent(event)) {
    // Duplicate sequence: no-op. The coordinator normally classifies these as
    // "ignore" before we get here, but this is a cheap safety net.
    if (slice.messageById[event.sequence]) return slice

    const msg: SessionMessage = {
      id: event.sequence,
      sessionId: slice.session.id,
      sequence: event.sequence,
      type: getMessageType(event.message),
      message: normalizeMessagePayload(event.message),
      createdAt: new Date().toISOString(),
    }
    const nextIds = insertSequenceSorted(slice.messageIds, event.sequence)
    const nextById = { ...slice.messageById, [event.sequence]: msg }

    // If this is a user message, it may be the echo of an optimistic prompt.
    let nextPending = slice.pendingPrompts
    if (msg.type === "user") {
      nextPending = reconcilePendingPrompts(slice.pendingPrompts, nextById)
    }

    return {
      ...slice,
      messageIds: nextIds,
      messageById: nextById,
      pendingPrompts: nextPending,
    }
  }

  switch (event.type) {
    case "session_complete":
      return { ...slice, session: { ...slice.session, status: "complete" } }
    case "session_error":
      return { ...slice, session: { ...slice.session, status: "errored" } }
    case "ask_user_question":
      return {
        ...slice,
        pendingQuestion: { questions: event.questions },
        session: { ...slice.session, status: "awaiting_user_input" },
      }
    case "presence":
      return { ...slice, presence: event.users ?? [] }
    default:
      return slice
  }
}

// ---------------------------------------------------------------------------
// Optimistic prompt reducers
// ---------------------------------------------------------------------------

export function reduceOptimisticPrompt(
  slice: SessionSlice,
  prompt: string,
  localId: string,
): SessionSlice {
  return {
    ...slice,
    pendingPrompts: [
      ...slice.pendingPrompts,
      { localId, prompt, createdAt: new Date().toISOString() },
    ],
    // Optimistically flip status so phase derivation reflects the resume
    // before the server's first event arrives.
    session: { ...slice.session, status: "running" },
  }
}

export function reduceClearPendingQuestion(slice: SessionSlice): SessionSlice {
  return { ...slice, pendingQuestion: null }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function insertSequenceSorted(ids: readonly number[], seq: number): number[] {
  if (ids.length === 0) return [seq]
  const last = ids[ids.length - 1]!
  if (seq > last) return [...ids, seq] // fast path — events usually arrive in order
  const next = ids.slice()
  let i = next.length
  while (i > 0 && next[i - 1]! > seq) i--
  next.splice(i, 0, seq)
  return next
}

function extractUserText(msg: SessionMessage | undefined): string | null {
  if (!msg || msg.type !== "user") return null
  const payload = msg.message as { content?: unknown }
  const content = payload?.content
  if (typeof content === "string") return content.trim()
  if (Array.isArray(content)) {
    const text = content
      .filter((b): b is { type: "text"; text: string } => !!b && typeof b === "object" && (b as { type?: unknown }).type === "text")
      .map((b) => b.text)
      .join("")
    return text.trim() || null
  }
  return null
}

function reconcilePendingPrompts(
  pending: readonly PendingPrompt[],
  messageById: Record<number, SessionMessage>,
): PendingPrompt[] {
  if (pending.length === 0) return []
  const userTexts = new Set<string>()
  for (const id of Object.keys(messageById)) {
    const text = extractUserText(messageById[Number(id)])
    if (text) userTexts.add(text)
  }
  const next = pending.filter((p) => !userTexts.has(p.prompt.trim()))
  return next.length === pending.length ? pending.slice() : next
}
