/**
 * Gmail-specific API functions.
 * These call Gmail plugin routes (mounted at /api/gmail/*).
 */
import { decodeApiJsonResponse } from "@hammies/contracts/http"
import { z } from "zod"
import {
  GmailLabelSchema,
  GmailSearchResponseSchema,
  GmailThreadSchema,
} from "./types"

const BASE = "/api"

async function request<T>(path: string, schema: z.ZodType<T>, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  })
  return decodeApiJsonResponse(res, schema, { contract: `gmail-${path.split("?")[0]}@1`, source: path })
}

const LabelsSchema = z.object({
  labels: z.array(GmailLabelSchema),
}).strict()
const IdSchema = z.object({ id: z.string() }).passthrough()
const OkSchema = z.object({ ok: z.boolean() }).passthrough()

export async function searchEmails(query: string, maxResults = 50, pageToken?: string) {
  const params = new URLSearchParams({ q: query, max: String(maxResults) })
  if (pageToken) params.set("pageToken", pageToken)
  return request(`/gmail/messages?${params}`, GmailSearchResponseSchema)
}

export async function getEmailThread(threadId: string) {
  return request(`/gmail/threads/${threadId}`, GmailThreadSchema)
}

export async function getEmailLabels() {
  return request(`/gmail/labels`, LabelsSchema)
}

export async function sendEmail(body: {
  to: string; subject: string; body: string; threadId?: string; inReplyTo?: string; references?: string
}) {
  return request(`/gmail/send`, IdSchema, { method: "POST", body: JSON.stringify(body) })
}

export async function createDraft(body: {
  to: string; subject: string; body: string; threadId?: string; inReplyTo?: string; references?: string
}) {
  return request(`/gmail/drafts`, IdSchema, { method: "POST", body: JSON.stringify(body) })
}

export async function trashThread(threadId: string) {
  return request(`/gmail/threads/${threadId}/trash`, OkSchema, { method: "POST" })
}

export async function modifyThreadLabels(threadId: string, body: { addLabelIds?: string[]; removeLabelIds?: string[] }) {
  return request(`/gmail/threads/${threadId}/labels`, OkSchema, { method: "PATCH", body: JSON.stringify(body) })
}
