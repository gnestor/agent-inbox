const BASE = "/api"

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const method = options?.method ?? "GET"
  if (import.meta.env.DEV) {
    console.log(`[api] ${method} ${path}`)
  }
  const start = import.meta.env.DEV ? performance.now() : 0
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  })
  if (!res.ok) {
    const text = await res.text()
    if (import.meta.env.DEV) {
      console.error(`[api] ${method} ${path} → ${res.status} (${(performance.now() - start).toFixed(0)}ms)`, text)
    }
    throw new Error(`API ${res.status}: ${text}`)
  }
  if (import.meta.env.DEV) {
    console.log(`[api] ${method} ${path} → ${res.status} (${(performance.now() - start).toFixed(0)}ms)`)
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
    `/notion-tasks/options/${encodeURIComponent(property)}`,
  )
}

export async function getTaskAssignees() {
  return request<{ assignees: string[] }>(`/notion-tasks/assignees`)
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
  const result = await request<{ items: import("@/types").NotionTask[]; nextCursor?: string }>(
    `/notion-tasks/items${qs ? `?${qs}` : ""}`,
  )
  return { tasks: result.items, nextCursor: result.nextCursor ?? null }
}

export async function getTask(taskId: string) {
  return request<import("@/types").NotionTaskDetail>(`/notion-tasks/items/${taskId}`)
}

export async function updateTask(taskId: string, properties: import("@/types/notion-mutations").TaskPropertyUpdate) {
  return request<{ ok: boolean }>(`/notion-tasks/items/${taskId}/mutate`, {
    method: "POST",
    body: JSON.stringify({ action: "update-properties", payload: properties }),
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
    `/notion-calendar/items${qs ? `?${qs}` : ""}`,
  )
}

export async function getCalendarItem(itemId: string) {
  return request<import("@/types").NotionCalendarItemDetail>(`/notion-calendar/items/${itemId}`)
}

export async function updateCalendarItem(itemId: string, properties: import("@/types/notion-mutations").CalendarPropertyUpdate) {
  return request<{ ok: boolean }>(`/notion-calendar/items/${itemId}/mutate`, {
    method: "POST",
    body: JSON.stringify({ action: "update-properties", payload: properties }),
  })
}

export async function getCalendarAssignees() {
  return request<{ assignees: string[] }>(`/notion-calendar/calendar-assignees`)
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

export async function updateArtifactCode(sessionId: string, sequence: number, code: string) {
  return request<{ ok: boolean }>(`/sessions/${sessionId}/artifact`, {
    method: "PATCH",
    body: JSON.stringify({ sequence, code }),
  })
}

export async function abortSession(sessionId: string) {
  return request<{ ok: boolean }>(`/sessions/${sessionId}/abort`, {
    method: "POST",
  })
}

export async function archiveSession(sessionId: string) {
  return request<{ ok: boolean }>(`/sessions/${sessionId}/archive`, {
    method: "POST",
  })
}

export async function unarchiveSession(sessionId: string) {
  return request<{ ok: boolean }>(`/sessions/${sessionId}/unarchive`, {
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

export async function uploadSessionFile(sessionId: string, file: File) {
  const form = new FormData()
  form.append("file", file)
  const res = await fetch(`${BASE}/sessions/${sessionId}/files`, {
    method: "POST",
    body: form,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API ${res.status}: ${text}`)
  }
  return res.json() as Promise<{ name: string; path: string; size: number; mimeType: string }>
}

export function getSessionFileUrl(sessionId: string, filename: string, absolutePath?: string): string {
  const base = `${BASE}/sessions/${sessionId}/files/${encodeURIComponent(filename)}`
  if (absolutePath) {
    return `${base}?path=${encodeURIComponent(absolutePath)}`
  }
  return base
}

export async function getLinkedSession(sourceId: string, sourceType: string) {
  const params = new URLSearchParams({ sourceId, sourceType })
  return request<{ session: { id: string; status: string; prompt: string; summary: string | null; updatedAt: string } | null }>(
    `/sessions/linked?${params}`,
  )
}

// Plugins

export interface PluginManifest {
  id: string
  name: string
  icon: string
  emoji?: string
  components?: import("@/types/plugin").PluginComponents
  auth?: { integrationId: string; scope: "user" | "workspace" }
  fieldSchema: import("@/types/plugin").FieldDef[]
  detailSchema?: import("@/types/panels").WidgetDef[]
  hasSubItems?: boolean
  hasGetItem?: boolean
  hasFilterOptions?: boolean
}

export async function getPlugins() {
  return request<PluginManifest[]>(`/plugins`)
}

export async function queryPluginItems(
  pluginId: string,
  filters: Record<string, string>,
  cursor?: string
) {
  const params = new URLSearchParams(filters)
  if (cursor) params.set("cursor", cursor)
  const qs = params.toString()
  return request<{ items: import("@/types/plugin").PluginItem[]; nextCursor?: string }>(
    `/${pluginId}/items${qs ? `?${qs}` : ""}`,
  )
}

export async function getPluginItem(
  pluginId: string,
  itemId: string,
) {
  return request<import("@/types/plugin").PluginItem>(
    `/${pluginId}/items/${encodeURIComponent(itemId)}`,
  )
}

export async function queryPluginSubItems(
  pluginId: string,
  itemId: string,
  filters: Record<string, string>,
  cursor?: string
) {
  const params = new URLSearchParams(filters)
  if (cursor) params.set("cursor", cursor)
  const qs = params.toString()
  return request<{ items: import("@/types/plugin").PluginItem[]; nextCursor?: string }>(
    `/${pluginId}/items/${itemId}/subitems${qs ? `?${qs}` : ""}`,
  )
}

export async function getFieldOptions(
  pluginId: string,
  fieldId: string,
) {
  return request<{ options: string[] }>(
    `/${pluginId}/fields/${fieldId}/options`,
  )
}

export async function getPanelSchemas() {
  return request<Record<string, import("@/types/panels").WidgetDef[]>>(`/panels`)
}

export async function mutatePluginItem(
  pluginId: string,
  itemId: string,
  action: string,
  payload?: unknown
) {
  return request<{ ok: boolean }>(`/${pluginId}/items/${itemId}/mutate`, {
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

export async function getUserProfiles(emails: string[]): Promise<{ users: { email: string; name: string; picture?: string }[] }> {
  return request(`/users?emails=${emails.map(encodeURIComponent).join(",")}`)
}
