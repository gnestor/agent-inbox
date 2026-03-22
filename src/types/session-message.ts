// Session message discriminated union types
//
// The Claude Agent SDK emits messages with either `type` or `role` as the
// discriminator, and content can live at `.content` or `.message.content`.
// We normalize at the SSE boundary (use-session-stream.ts) so all messages
// have a `type` field, then narrow via this union.

// ---------------------------------------------------------------------------
// Content blocks (inside assistant messages)
// ---------------------------------------------------------------------------

export type ContentBlock =
  | TextBlock
  | ToolUseBlock
  | ThinkingBlock

export interface TextBlock {
  type: "text"
  text: string
}

export interface ToolUseBlock {
  type: "tool_use"
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ThinkingBlock {
  type: "thinking"
  thinking: string
}

// ---------------------------------------------------------------------------
// Message payload union (the `.message` field of SessionMessage)
// ---------------------------------------------------------------------------

export type SessionMessagePayload =
  | SystemInitMessage
  | SystemResultMessage
  | SystemAttachedContextMessage
  | UserMessage
  | AssistantMessage
  | PlanMessage
  | ToolResultMessage

// --- System messages (discriminated by subtype) ---

interface SystemBase {
  type: "system"
}

export interface SystemInitMessage extends SystemBase {
  subtype: "init"
  session_id?: string
}

export interface SystemResultMessage extends SystemBase {
  subtype: "result"
  result: string
}

export interface SystemAttachedContextMessage extends SystemBase {
  subtype: "attached_context"
  title: string
  content?: string
}

// --- User messages ---

export interface UserMessage {
  type: "user"
  role?: "user"
  content: string | ContentBlock[]
  message?: { content: string | ContentBlock[] }
  authorEmail?: string
  authorName?: string
  authorPicture?: string
}

// --- Assistant messages ---

export interface AssistantMessage {
  type: "assistant"
  role?: "assistant"
  content: ContentBlock[]
  message?: { content: ContentBlock[] }
}

// --- Plan messages ---

export interface PlanMessage {
  type: "plan"
  content: string
}

// --- Tool result messages (rendered as null) ---

export interface ToolResultMessage {
  type: "tool_result"
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export type SystemMessage = SystemInitMessage | SystemResultMessage | SystemAttachedContextMessage

export function isSystemMessage(msg: SessionMessagePayload): msg is SystemMessage {
  return msg.type === "system"
}

export function isUserMessage(msg: SessionMessagePayload): msg is UserMessage {
  return msg.type === "user"
}

export function isAssistantMessage(msg: SessionMessagePayload): msg is AssistantMessage {
  return msg.type === "assistant"
}

// ---------------------------------------------------------------------------
// Normalizer — call at the SSE boundary to ensure `type` is always set
// ---------------------------------------------------------------------------

/** Normalize a raw SDK message so it always has a `type` field. Non-mutating. */
export function normalizeMessagePayload(raw: unknown): SessionMessagePayload {
  if (!raw || typeof raw !== "object") {
    return { type: "system", subtype: "init" } as SystemInitMessage
  }
  const src = raw as Record<string, unknown>

  // Only clone if we need to patch fields — avoid allocation in the common case
  const needsTypePatch = !src.type && src.role
  const needsSubtypePatch = src.type === "system" && !src.subtype && "result" in src

  if (!needsTypePatch && !needsSubtypePatch) {
    return src as unknown as SessionMessagePayload
  }

  const obj = { ...src }
  if (needsTypePatch) obj.type = obj.role
  if (needsSubtypePatch) obj.subtype = "result"
  return obj as unknown as SessionMessagePayload
}

/** Extract the message type string for the outer SessionMessage.type field. */
export function getMessageType(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "unknown"
  const obj = raw as Record<string, unknown>
  return (obj.type as string) || (obj.role as string) || "unknown"
}
