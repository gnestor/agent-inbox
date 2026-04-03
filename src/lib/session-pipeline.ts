// Pure functions for session transcript processing.
// No React imports — all functions are testable without a render context.

import type { SessionMessage } from "@/types"
import type {
  SessionMessagePayload,
  ContentBlock,
  TextBlock,
  ToolUseBlock,
  UserMessage,
  AssistantMessage,
} from "@/types/session-message"
import { isSubagentMessage, getAgentLabel, RENDER_OUTPUT_NAMES } from "@/types/session-message"

// Defined here (not in SessionTranscript) to avoid circular imports
export interface TranscriptVisibility {
  messages: boolean
  toolCalls: boolean
  thinking: boolean
  artifacts: boolean
}

export const DEFAULT_TRANSCRIPT_VISIBILITY: TranscriptVisibility = {
  messages: true,
  toolCalls: true,
  thinking: true,
  artifacts: true,
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Derived state computed in a single pass over all messages. */
export interface MessageLookups {
  /** tool_use_id → result text */
  toolResults: Map<string, string>
  /** tool_use_ids that have received a result */
  resolvedToolUseIDs: Set<string>
  /** Unique author emails found in user messages (sorted, for profile fetching) */
  authorEmails: string[]
}

export interface IdeRef {
  type: "file" | "selection"
  path: string
  filename: string
  selectionLines?: string
}

export type MessageDisplayType =
  | "system_init"
  | "system_result"
  | "system_attached"
  | "user_message"
  | "user_artifact_action"
  | "user_skill"
  | "assistant_blocks"
  | "assistant_text_only"
  | "plan"
  | "tool_result"
  | "hidden"

export interface ClassifiedMessage {
  source: SessionMessage
  displayType: MessageDisplayType
  /** Pre-extracted text content */
  text: string
  /** IDE context refs */
  ideRefs: IdeRef[]
  /** Skill block if user_skill */
  skillBlock: { name: string; content: string } | null
  /** Artifact action match if user_artifact_action */
  artifactAction: { intent: string; data: string } | null
  /** For assistant_blocks: pre-grouped content blocks */
  groupedBlocks: Array<ContentBlock | ToolUseBlock[]> | null
  /** Agent label for assistant messages */
  agentLabel: string
  /** Whether this is from a subagent */
  isSubagent: boolean
  /** Author email (user messages only) */
  authorEmail?: string
  /** Author display name (user messages only) */
  authorName?: string
}

// ---------------------------------------------------------------------------
// Constants (moved from SessionTranscript.tsx)
// ---------------------------------------------------------------------------

export const TOOL_DISPLAY_NAME: Record<string, string> = {
  ToolSearch: "Search tools",
}

export const TOOLS_WITH_DESCRIPTION = new Set(["Bash", "Agent"])

export const TOOL_PRIMARY_FIELD: Record<string, string> = {
  Read: "file_path", Write: "file_path", Edit: "file_path",
  Glob: "pattern", Grep: "pattern",
  WebFetch: "url", WebSearch: "query",
  ToolSearch: "query",
}

// ---------------------------------------------------------------------------
// Low-level utilities (moved from SessionTranscript.tsx)
// ---------------------------------------------------------------------------

export function extractXmlTag(text: string, tag: string): string | null {
  const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))
  return match ? match[1].trim() : null
}

/** Get content blocks from a message, checking both direct and nested paths. */
export function getContentBlocks(msg: UserMessage | AssistantMessage): ContentBlock[] {
  if (Array.isArray(msg.content)) return msg.content as ContentBlock[]
  if (Array.isArray(msg.message?.content)) return msg.message!.content as ContentBlock[]
  return []
}

function isIdeContextBlock(block: ContentBlock): boolean {
  if (block.type !== "text") return false
  return block.text.startsWith("<ide_opened_file>") || block.text.startsWith("<ide_selection>")
}

export function extractText(msg: SessionMessagePayload): string {
  if (msg.type === "plan") return msg.content
  if (msg.type === "system" || msg.type === "tool_result") return ""
  if (typeof msg.content === "string") return msg.content

  function extractFromBlocks(blocks: ContentBlock[]): string {
    return (blocks as ContentBlock[])
      .filter((b): b is TextBlock => b.type === "text")
      .map((b) => {
        if (!isIdeContextBlock(b)) return b.text
        return b.text
          .replace(/<ide_opened_file>[\s\S]*?<\/ide_opened_file>/g, "")
          .replace(/<ide_selection>[\s\S]*?<\/ide_selection>/g, "")
          .trim()
      })
      .filter(Boolean)
      .join("\n")
  }

  if (msg.message?.content) {
    if (typeof msg.message.content === "string") return msg.message.content
    if (Array.isArray(msg.message.content)) return extractFromBlocks(msg.message.content as ContentBlock[])
  }
  if (Array.isArray(msg.content)) return extractFromBlocks(msg.content as ContentBlock[])
  return ""
}

export function extractSkillBlock(msg: UserMessage | AssistantMessage): { name: string; content: string } | null {
  const blocks = getContentBlocks(msg)
  const skillBlock = blocks.find(
    (b) => b.type === "text" && b.text.startsWith("Base directory for this skill:"),
  )
  if (!skillBlock || skillBlock.type !== "text") return null
  const text = skillBlock.text
  const dirMatch = text.match(/Base directory for this skill: .+\/(.+)/)
  const name = dirMatch ? dirMatch[1] : "Skill"
  const content = text.replace(/^Base directory for this skill:[^\n]*\n?/, "").trim()
  return { name, content }
}

export function parseIdeContext(msg: UserMessage | AssistantMessage): IdeRef[] {
  const refs: IdeRef[] = []
  const blocks = getContentBlocks(msg)
  for (const block of blocks) {
    if (!isIdeContextBlock(block)) continue
    if (block.type !== "text") continue
    const text = block.text
    const fileMatch = text.match(/<ide_opened_file>The user opened the file (.+?) in the IDE/)
    if (fileMatch) {
      const path = fileMatch[1]
      refs.push({ type: "file", path, filename: path.split("/").pop() || path })
      continue
    }
    const selMatch = text.match(
      /<ide_selection>The user selected the lines (\d+) to (\d+) from (.+?):/,
    )
    if (selMatch) {
      const path = selMatch[3]
      refs.push({
        type: "selection",
        path,
        filename: path.split("/").pop() || path,
        selectionLines: `${selMatch[1]}-${selMatch[2]}`,
      })
    }
  }
  return refs
}

/** Group consecutive non-render_output tool_use blocks into arrays; other blocks stay individual. */
export function groupContentBlocks(blocks: ContentBlock[]): Array<ContentBlock | ToolUseBlock[]> {
  const groups: Array<ContentBlock | ToolUseBlock[]> = []
  let toolGroup: ToolUseBlock[] = []

  for (const block of blocks) {
    if (
      block.type === "tool_use" &&
      !RENDER_OUTPUT_NAMES.has(block.name) &&
      block.name !== "AskUserQuestion" &&
      block.name !== "ToolSearch"
    ) {
      toolGroup.push(block)
    } else {
      if (toolGroup.length > 0) {
        groups.push(toolGroup)
        toolGroup = []
      }
      groups.push(block)
    }
  }
  if (toolGroup.length > 0) groups.push(toolGroup)
  return groups
}

/** Short summary for accordion labels (e.g. file path, description). */
export function toolUseSummary(name: string, input: Record<string, unknown>): string {
  if (!input) return ""
  const str = (key: string): string => (typeof input[key] === "string" ? input[key] : "")
  if (name === "Bash") return str("description") || (typeof input.command === "string" ? input.command.slice(0, 60) : "")
  if (name === "Agent") return str("description")
  return TOOL_PRIMARY_FIELD[name] ? str(TOOL_PRIMARY_FIELD[name]) : ""
}

/** Raw command/input for the detail view (e.g. actual bash command, not description). */
export function toolUseCommand(name: string, input: Record<string, unknown>): string {
  if (!input) return ""
  const str = (key: string): string => (typeof input[key] === "string" ? input[key] : "")
  if (name === "Bash") return str("command")
  return TOOL_PRIMARY_FIELD[name] ? str(TOOL_PRIMARY_FIELD[name]) : ""
}

// ---------------------------------------------------------------------------
// Pipeline: buildLookups — single O(n) pass
// ---------------------------------------------------------------------------

/** Single pass over all messages to derive tool results and author emails. */
export function buildLookups(messages: SessionMessage[]): MessageLookups {
  const toolResults = new Map<string, string>()
  const resolvedToolUseIDs = new Set<string>()
  const emailSet = new Set<string>()

  for (const m of messages) {
    // Collect author emails
    const email = (m.message as any).authorEmail
    if (email) emailSet.add(email)

    // Collect tool results
    const raw = m.message as unknown as Record<string, unknown>
    const contentSources = [
      raw.content,
      (raw.message as Record<string, unknown> | undefined)?.content,
    ]
    for (const content of contentSources) {
      if (!Array.isArray(content)) continue
      for (const block of content) {
        if (
          block &&
          typeof block === "object" &&
          block.type === "tool_result" &&
          typeof block.tool_use_id === "string"
        ) {
          resolvedToolUseIDs.add(block.tool_use_id)
          const text = typeof block.content === "string"
            ? block.content
            : Array.isArray(block.content)
              ? block.content.map((c: any) => c.text || c.tool_name || "").join("\n")
              : ""
          if (text) toolResults.set(block.tool_use_id, text)
        }
      }
    }
  }

  return {
    toolResults,
    resolvedToolUseIDs,
    authorEmails: [...emailSet].sort(),
  }
}

// ---------------------------------------------------------------------------
// Pipeline: classifyMessage — pre-compute display metadata
// ---------------------------------------------------------------------------

/** Classify a single message for rendering. Moves all parsing out of TranscriptEntry. */
export function classifyMessage(message: SessionMessage): ClassifiedMessage {
  const msg = message.message
  const base = {
    source: message,
    text: "",
    ideRefs: [] as IdeRef[],
    skillBlock: null as { name: string; content: string } | null,
    artifactAction: null as { intent: string; data: string } | null,
    groupedBlocks: null as Array<ContentBlock | ToolUseBlock[]> | null,
    agentLabel: "Claude",
    isSubagent: isSubagentMessage(message),
  }

  if (msg.type === "system") {
    if (msg.subtype === "init") return { ...base, displayType: "system_init" }
    if (msg.subtype === "result") return { ...base, displayType: "system_result", text: msg.result || "Session completed" }
    if (msg.subtype === "attached_context") return { ...base, displayType: "system_attached", text: msg.title }
    return { ...base, displayType: "hidden" }
  }

  if (msg.type === "user") {
    // Synthetic/meta messages are always hidden
    if (("isSynthetic" in msg && msg.isSynthetic) || ("isMeta" in msg && msg.isMeta)) {
      return { ...base, displayType: "hidden" }
    }

    const text = extractText(msg)
    const authorEmail = (msg as any).authorEmail as string | undefined
    const authorName = (msg as any).authorName as string | undefined

    const userBase = { ...base, authorEmail, authorName }

    // Artifact action
    const actionMatch = text?.match(/^<artifact_action\s+intent="([^"]*)">([\s\S]*?)<\/artifact_action>$/)
    if (actionMatch) {
      return {
        ...userBase,
        displayType: "user_artifact_action",
        text,
        artifactAction: { intent: actionMatch[1], data: actionMatch[2]?.trim() },
      }
    }

    // Skill injection
    const skillBlock = extractSkillBlock(msg)
    if (skillBlock) {
      return { ...userBase, displayType: "user_skill", text, skillBlock }
    }

    // Normal user message
    const ideRefs = parseIdeContext(msg)
    return { ...userBase, displayType: "user_message", text, ideRefs }
  }

  if (msg.type === "assistant") {
    const agentLabel = getAgentLabel(message)
    const contentBlocks = getContentBlocks(msg)

    if (contentBlocks.length === 0) {
      const text = extractText(msg)
      return { ...base, displayType: "assistant_text_only", text, agentLabel }
    }

    const groupedBlocks = groupContentBlocks(contentBlocks)
    return { ...base, displayType: "assistant_blocks", agentLabel, groupedBlocks }
  }

  if (msg.type === "plan") {
    return { ...base, displayType: "plan", text: msg.content || "" }
  }

  if (msg.type === "tool_result") {
    return { ...base, displayType: "tool_result" }
  }

  return { ...base, displayType: "hidden" }
}

// ---------------------------------------------------------------------------
// Pipeline: isVisible — replaces shouldRenderMessage + shouldRenderContentBlock
// ---------------------------------------------------------------------------

function shouldRenderContentBlock(
  block: ContentBlock,
  visibility: TranscriptVisibility,
  hasSessionId: boolean,
): boolean {
  if (block.type === "text") return visibility.messages && !!block.text
  if (block.type === "tool_use") {
    if (RENDER_OUTPUT_NAMES.has(block.name)) return visibility.artifacts && !!block.input && hasSessionId
    if (block.name === "AskUserQuestion") return true
    return visibility.toolCalls
  }
  if (block.type === "thinking") return visibility.thinking && !!block.thinking
  return false
}

/** Determine whether a classified message should be rendered given current visibility settings. */
export function isVisible(cm: ClassifiedMessage, visibility: TranscriptVisibility): boolean {
  switch (cm.displayType) {
    case "system_init":
    case "tool_result":
    case "hidden":
      return false

    case "system_result":
    case "system_attached":
      return visibility.messages

    case "user_artifact_action":
    case "user_skill":
      return true

    case "user_message":
      if (!visibility.messages) return false
      return !!cm.text || cm.ideRefs.length > 0

    case "assistant_text_only":
      return visibility.messages && !!cm.text

    case "assistant_blocks": {
      const blocks = getContentBlocks(cm.source.message as AssistantMessage)
      return blocks.some((block) => shouldRenderContentBlock(block, visibility, !!cm.source.sessionId))
    }

    case "plan":
      return visibility.messages && !!cm.text

    default:
      return false
  }
}

// ---------------------------------------------------------------------------
// Pipeline: processTranscript — top-level orchestrator
// ---------------------------------------------------------------------------

export interface ProcessedTranscript {
  lookups: MessageLookups
  classified: ClassifiedMessage[]
}

/** Process raw messages into classified messages + lookups. Pure function. */
export function processTranscript(messages: SessionMessage[]): ProcessedTranscript {
  const lookups = buildLookups(messages)
  const classified = messages.map(classifyMessage)
  return { lookups, classified }
}

/** Filter classified messages by visibility. Separate from processTranscript so
 *  visibility changes don't recompute lookups or classification. */
export function filterVisible(classified: ClassifiedMessage[], visibility: TranscriptVisibility): ClassifiedMessage[] {
  return classified.filter((cm) => isVisible(cm, visibility))
}
