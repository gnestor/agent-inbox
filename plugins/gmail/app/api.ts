/**
 * Gmail-specific API functions.
 * These call Gmail plugin routes (mounted at /api/gmail/*).
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
  return request<{ messages: unknown[]; nextPageToken: string | null }>(`/gmail/messages?${params}`)
}

export async function getEmailThread(threadId: string) {
  return request<unknown>(`/gmail/threads/${threadId}`)
}

export async function getEmailLabels() {
  return request<{ labels: { id: string; name: string; type: string }[] }>(`/gmail/labels`)
}

export async function sendEmail(body: {
  to: string; subject: string; body: string; threadId?: string; inReplyTo?: string; references?: string
}) {
  return request<{ id: string }>(`/gmail/send`, { method: "POST", body: JSON.stringify(body) })
}

export async function createDraft(body: {
  to: string; subject: string; body: string; threadId?: string; inReplyTo?: string; references?: string
}) {
  return request<{ id: string }>(`/gmail/drafts`, { method: "POST", body: JSON.stringify(body) })
}

export async function trashThread(threadId: string) {
  return request<{ ok: boolean }>(`/gmail/threads/${threadId}/trash`, { method: "POST" })
}

export async function modifyThreadLabels(threadId: string, body: { addLabelIds?: string[]; removeLabelIds?: string[] }) {
  return request<{ ok: boolean }>(`/gmail/threads/${threadId}/labels`, { method: "PATCH", body: JSON.stringify(body) })
}
