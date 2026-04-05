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

/** Tool names for render_output (MCP and direct). */
export const RENDER_OUTPUT_NAMES = new Set(["render_output", "mcp__render_output__render_output"])

/** Tool names for create_file / present_files artifact tools */
export const CREATE_FILE_NAMES = new Set(["create_file", "mcp__artifact__create_file"])
export const PRESENT_FILES_NAMES = new Set(["present_files", "mcp__artifact__present_files"])

/** Check if a message is from/to a subagent (not the human user). */
export function isSubagentMessage(message: { type: string; message: unknown }): boolean {
  const raw = message.message as Record<string, unknown>
  // isSidechain: true = subagent conversation
  // parentUuid: set = message in a parent-child chain (agent → subagent)
  // sourceToolUseID: set = message injected by a tool (skill, agent)
  // agentId on user messages = prompt sent TO a subagent
  return !!(
    raw.isSidechain === true ||
    raw.parentUuid ||
    raw.sourceToolUseID ||
    (raw.agentId && message.type === "user")
  )
}

/** Extract a display label for the agent that produced a message. */
export function getAgentLabel(message: { message: unknown }): string {
  const raw = message.message as Record<string, unknown>
  if (raw.slug) return String(raw.slug)
  if (raw.agentId) return String(raw.agentId)
  return "Claude"
}
