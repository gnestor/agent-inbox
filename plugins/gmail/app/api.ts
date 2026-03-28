/**
 * Gmail plugin client-side API functions.
 * Re-exported from @/api/client for backward compatibility.
 * In Phase 8, these will be used directly inside iframe components.
 */

const BASE = "/api"

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API ${res.status}: ${text}`)
  }
  return res.json()
}

export async function searchEmails(query: string, maxResults = 50, pageToken?: string) {
  const params = new URLSearchParams({ q: query, max: String(maxResults) })
  if (pageToken) params.set("pageToken", pageToken)
  return request<{ messages: GmailMessage[]; nextPageToken: string | null }>(
    `/gmail/messages?${params}`,
  )
}

export async function getEmailThread(threadId: string) {
  return request<GmailThread>(`/gmail/threads/${threadId}`)
}

export async function getEmailLabels() {
  return request<{ labels: GmailLabel[] }>(`/gmail/labels`)
}

export async function createDraft(body: {
  to: string
  subject: string
  body: string
  threadId?: string
  inReplyTo?: string
}) {
  return request<{ id: string }>(`/gmail/drafts`, {
    method: "POST",
    body: JSON.stringify(body),
  })
}

export async function sendEmail(body: {
  to: string
  subject: string
  body: string
  threadId?: string
  inReplyTo?: string
}) {
  return request<{ id: string }>(`/gmail/send`, {
    method: "POST",
    body: JSON.stringify(body),
  })
}

export async function trashThread(threadId: string) {
  return request<{ ok: boolean }>(`/gmail/threads/${threadId}/trash`, {
    method: "POST",
  })
}

export async function modifyThreadLabels(
  threadId: string,
  body: { addLabelIds?: string[]; removeLabelIds?: string[] },
) {
  return request<{ ok: boolean }>(`/gmail/threads/${threadId}/labels`, {
    method: "PATCH",
    body: JSON.stringify(body),
  })
}

// ─── Gmail types (local to avoid @/ imports in iframe context) ──────────────

export interface GmailMessage {
  id: string
  threadId: string
  labelIds?: string[]
  snippet: string
  from: string
  to: string
  subject: string
  date: string
  body: string
  bodyFormat: "markdown" | "plain"
  isUnread: boolean
  attachments?: Array<{ attachmentId: string; filename: string; mimeType: string; size: number }>
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
