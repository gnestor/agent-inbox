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

// Auth

export async function getAuthClientId() {
  return request<{ clientId: string }>(`/auth/client-id`)
}

export async function authCallback(credential: string) {
  return request<import("@/types").UserProfile>(`/auth/callback`, {
    method: "POST",
    body: JSON.stringify({ credential }),
  })
}

export async function getAuthSession() {
  return request<{ user: import("@/types").UserProfile | null }>(`/auth/session`)
}

export async function logout() {
  return request<{ ok: boolean }>(`/auth/logout`, { method: "POST" })
}

// Gmail

export async function searchEmails(query: string, maxResults = 50, pageToken?: string) {
  const params = new URLSearchParams({ q: query, max: String(maxResults) })
  if (pageToken) params.set("pageToken", pageToken)
  return request<{ messages: import("@/types").GmailMessage[]; nextPageToken: string | null }>(
    `/gmail/messages?${params}`,
  )
}

export async function getEmailThread(threadId: string) {
  return request<import("@/types").GmailThread>(`/gmail/threads/${threadId}`)
}

export async function getEmailLabels() {
  return request<{ labels: import("@/types").GmailLabel[] }>(`/gmail/labels`)
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

// Notion

export async function getNotionOptions(property: string) {
  return request<{ options: { value: string; color: string | null }[] }>(
    `/notion/options/${encodeURIComponent(property)}`,
  )
}

export async function getTaskAssignees() {
  return request<{ assignees: string[] }>(`/notion/assignees`)
}

export async function getTasks(filters?: {
  status?: string
  tags?: string
  assignee?: string
  priority?: string
  cursor?: string
}) {
  const params = new URLSearchParams()
  if (filters?.status) params.set("status", filters.status)
  if (filters?.tags) params.set("tags", filters.tags)
  if (filters?.assignee) params.set("assignee", filters.assignee)
  if (filters?.priority) params.set("priority", filters.priority)
  if (filters?.cursor) params.set("cursor", filters.cursor)
  const qs = params.toString()
  return request<{ tasks: import("@/types").NotionTask[]; nextCursor: string | null }>(
    `/notion/tasks${qs ? `?${qs}` : ""}`,
  )
}

export async function getTask(taskId: string) {
  return request<import("@/types").NotionTaskDetail>(`/notion/tasks/${taskId}`)
}

export async function updateTask(taskId: string, properties: Record<string, unknown>) {
  return request<{ ok: boolean }>(`/notion/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify(properties),
  })
}

export async function getCalendarItems(filters?: {
  status?: string
  tags?: string
  assignee?: string
  cursor?: string
}) {
  const params = new URLSearchParams()
  if (filters?.status) params.set("status", filters.status)
  if (filters?.tags) params.set("tags", filters.tags)
  if (filters?.assignee) params.set("assignee", filters.assignee)
  if (filters?.cursor) params.set("cursor", filters.cursor)
  const qs = params.toString()
  return request<{ items: import("@/types").NotionCalendarItem[]; nextCursor: string | null }>(
    `/notion/calendar${qs ? `?${qs}` : ""}`,
  )
}

export async function getCalendarItem(itemId: string) {
  return request<import("@/types").NotionCalendarItemDetail>(`/notion/calendar/${itemId}`)
}

export async function updateCalendarItem(itemId: string, properties: Record<string, unknown>) {
  return request<{ ok: boolean }>(`/notion/calendar/${itemId}`, {
    method: "PATCH",
    body: JSON.stringify(properties),
  })
}

export async function getCalendarAssignees() {
  return request<{ assignees: string[] }>(`/notion/calendar-assignees`)
}

// Sessions

export async function getSessions(filters?: {
  status?: string
  triggerSource?: string
  project?: string
  q?: string
}) {
  const params = new URLSearchParams()
  if (filters?.status) params.set("status", filters.status)
  if (filters?.triggerSource) params.set("trigger_source", filters.triggerSource)
  if (filters?.project) params.set("project", filters.project)
  if (filters?.q) params.set("q", filters.q)
  const qs = params.toString()
  return request<{ sessions: import("@/types").Session[] }>(`/sessions${qs ? `?${qs}` : ""}`)
}

export async function getSessionProjects() {
  return request<{ projects: string[] }>(`/sessions/projects`)
}

export async function getSession(sessionId: string) {
  return request<{
    session: import("@/types").Session
    messages: import("@/types").SessionMessage[]
  }>(`/sessions/${sessionId}`)
}

export async function updateSession(sessionId: string, body: { summary: string }) {
  return request<{ ok: boolean }>(`/sessions/${sessionId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  })
}

export async function createSession(body: {
  prompt: string
  linkedEmailId?: string
  linkedEmailThreadId?: string
  linkedTaskId?: string
}) {
  return request<{ sessionId: string }>(`/sessions`, {
    method: "POST",
    body: JSON.stringify(body),
  })
}

export async function resumeSession(sessionId: string, prompt: string) {
  return request<{ ok: boolean }>(`/sessions/${sessionId}/resume`, {
    method: "POST",
    body: JSON.stringify({ prompt }),
  })
}

export async function abortSession(sessionId: string) {
  return request<{ ok: boolean }>(`/sessions/${sessionId}/abort`, {
    method: "POST",
  })
}

export async function answerSessionQuestion(sessionId: string, answers: Record<string, string>) {
  return request<{ ok: boolean }>(`/sessions/${sessionId}/answer`, {
    method: "POST",
    body: JSON.stringify({ answers }),
  })
}

export async function attachToSession(
  sessionId: string,
  body: { type: string; id: string; title: string; content: string },
) {
  return request<{ ok: boolean }>(`/sessions/${sessionId}/attach`, {
    method: "POST",
    body: JSON.stringify(body),
  })
}

export async function getLinkedSession(threadId?: string, taskId?: string) {
  const params = new URLSearchParams()
  if (threadId) params.set("threadId", threadId)
  if (taskId) params.set("taskId", taskId)
  return request<{ session: { id: string; status: string; prompt: string; summary: string | null; updatedAt: string } | null }>(
    `/sessions/linked?${params}`,
  )
}

// Plugins

export interface PluginManifest {
  id: string
  name: string
  icon: string
  fieldSchema: import("@/types/plugin").FieldDef[]
  detailSchema?: import("@/types/panels").WidgetDef[]
  hasSubItems?: boolean
}

export async function getPlugins() {
  return request<PluginManifest[]>(`/plugins`)
}

export async function queryPluginItems(
  sourceId: string,
  filters: Record<string, string>,
  cursor?: string
) {
  const params = new URLSearchParams(filters)
  if (cursor) params.set("cursor", cursor)
  const qs = params.toString()
  return request<{ items: import("@/types/plugin").PluginItem[]; nextCursor?: string }>(
    `/plugins/${sourceId}/items${qs ? `?${qs}` : ""}`,
  )
}

export async function queryPluginSubItems(
  sourceId: string,
  itemId: string,
  filters: Record<string, string>,
  cursor?: string
) {
  const params = new URLSearchParams(filters)
  if (cursor) params.set("cursor", cursor)
  const qs = params.toString()
  return request<{ items: import("@/types/plugin").PluginItem[]; nextCursor?: string }>(
    `/plugins/${sourceId}/items/${itemId}/subitems${qs ? `?${qs}` : ""}`,
  )
}

export async function getPanelSchemas() {
  return request<Record<string, import("@/types/panels").WidgetDef[]>>(`/panels`)
}

export async function mutatePluginItem(
  sourceId: string,
  itemId: string,
  action: string,
  payload?: unknown
) {
  return request<{ ok: boolean }>(`/plugins/${sourceId}/items/${itemId}/mutate`, {
    method: "POST",
    body: JSON.stringify({ action, payload }),
  })
}

// Connections

export async function getConnections() {
  return request<{ integrations: import("@/types").Integration[] }>(`/connections`)
}

export async function disconnectIntegration(integration: string) {
  return request<{ ok: boolean }>(`/connections/${integration}`, {
    method: "DELETE",
  })
}

/**
 * Get the OAuth connect URL for an integration.
 * Returns the URL to redirect to (browser navigation, not fetch).
 */
export function getConnectUrl(integration: string): string {
  return `${BASE}/connections/connect/${integration}`
}

// Preferences

export async function getPreferences() {
  return request<Record<string, unknown>>(`/preferences`)
}

export async function setPreference(key: string, value: unknown) {
  return request<{ ok: boolean }>(`/preferences`, {
    method: "PUT",
    body: JSON.stringify({ key, value }),
  })
}
