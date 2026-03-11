// User types

export interface UserProfile {
  name: string
  email: string
  picture?: string
}

// Gmail types

export interface GmailMessage {
  id: string
  threadId: string
  labelIds: string[]
  snippet: string
  from: string
  to: string
  subject: string
  date: string
  body: string
  bodyIsHtml: boolean
  isUnread: boolean
}

export interface GmailThread {
  id: string
  messages: GmailMessage[]
  subject: string
  snippet: string
  from: string
  date: string
  messageCount: number
  isUnread: boolean
  labelIds: string[]
}

export interface GmailLabel {
  id: string
  name: string
  type: string
  messagesTotal?: number
  messagesUnread?: number
}

// Notion types

export interface NotionTask {
  id: string
  title: string
  status: string
  tags: string[]
  priority: string
  assignee: string
  createdAt: string
  updatedAt: string
  url: string
}

export interface NotionProperty {
  date?: { start?: string }
  created_by?: { name?: string }
  [key: string]: unknown
}

export interface NotionTaskDetail extends NotionTask {
  body: string
  properties: Record<string, NotionProperty>
  children: import("../components/task/NotionBlockRenderer").NotionBlock[]
}

// Session types

export type SessionStatus = "running" | "complete" | "needs_attention" | "errored" | "awaiting_user_input"

export interface AskUserQuestionOption {
  label: string
  description: string
  preview?: string
}

export interface AskUserQuestion {
  question: string
  header: string
  options: AskUserQuestionOption[]
  multiSelect: boolean
}

export interface PendingQuestion {
  questions: AskUserQuestion[]
}
export type TriggerSource = "manual" | "inbox" | "email_triage" | "webhook_notion" | "webhook_slack"

// Inbox workflow structured output types (from <inbox-context> and <inbox-result> XML blocks)

export interface InboxContextData {
  entity: {
    type: "person" | "company" | "topic"
    name: string
    email: string | null
    domain: string | null
    company: string | null
    role: string | null
  }
  source: {
    type: "email" | "task"
    id: string
    threadId: string | null
    subject: string | null
    from: string | null
    date: string | null
    snippet: string
  }
  contextPages: Array<{ file: string; title: string; summary: string; tags: string[] }>
  relatedThreads: Array<{ threadId: string; subject: string; date: string; snippet: string }>
  relatedTasks: Array<{ id: string; title: string; status: string; url: string }>
  summary: string
}

export type InboxResultAction = "draft" | "task" | "context_updated" | "skipped"

export interface InboxResultData {
  action: InboxResultAction
  draft?: {
    to: string
    subject: string
    body: string
    threadId: string | null
    inReplyTo: string | null
  }
  task?: { id: string; title: string; status: string; url: string }
  contextUpdated?: string[]
  summary: string
}

export interface Session {
  id: string
  status: SessionStatus
  prompt: string
  summary: string | null
  startedAt: string
  updatedAt: string
  completedAt: string | null
  messageCount: number
  linkedEmailId: string | null
  linkedEmailThreadId: string | null
  linkedTaskId: string | null
  triggerSource: TriggerSource
  project: string
}

export interface SessionMessage {
  id: number
  sessionId: string
  sequence: number
  type: string
  message: unknown
  createdAt: string
}

// Link types

export interface EmailTaskLink {
  emailId: string
  emailThreadId: string
  taskId: string
  createdAt: string
}

// Filter types

export interface EmailFilters {
  query: string
  label: string
}

export interface TaskFilters {
  status: string
  tags: string[]
  assignee: string
  priority: string
}

export interface SessionFilters {
  status: SessionStatus | ""
  triggerSource: TriggerSource | ""
}
