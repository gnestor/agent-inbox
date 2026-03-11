import { getGoogleAccessToken } from "./credentials.js"
import { sanitizePlainText, sanitizeHtmlEmail, type SanitizeOptions } from "./email-sanitizer.js"

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"

async function gmailRequest(path: string, options?: RequestInit) {
  const token = await getGoogleAccessToken()
  const res = await fetch(`${GMAIL_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Gmail API ${res.status}: ${text}`)
  }
  return res.json()
}

export function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/")
  return Buffer.from(base64, "base64").toString("utf-8")
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

export function getHeader(message: any, name: string): string {
  return (
    message.payload?.headers?.find((h: any) => h.name.toLowerCase() === name.toLowerCase())
      ?.value || ""
  )
}

export function getEmailBody(message: any): { body: string; bodyIsHtml: boolean } {
  const payload = message.payload
  if (!payload) return { body: "", bodyIsHtml: false }

  if (payload.body?.data) {
    const text = decodeBase64Url(payload.body.data)
    const isHtml = payload.mimeType === "text/html"
    return {
      body: isHtml ? text.replace(/<script[^>]*>.*?<\/script>/gs, "") : text,
      bodyIsHtml: isHtml,
    }
  }

  if (payload.parts) {
    const htmlPart = payload.parts.find((p: any) => p.mimeType === "text/html")
    if (htmlPart?.body?.data) {
      const html = decodeBase64Url(htmlPart.body.data).replace(/<script[^>]*>.*?<\/script>/gs, "")
      return { body: html, bodyIsHtml: true }
    }

    const textPart = payload.parts.find((p: any) => p.mimeType === "text/plain")
    if (textPart?.body?.data)
      return { body: decodeBase64Url(textPart.body.data), bodyIsHtml: false }

    for (const part of payload.parts) {
      if (part.parts) {
        const htmlSub = part.parts.find((p: any) => p.mimeType === "text/html")
        if (htmlSub?.body?.data) {
          const html = decodeBase64Url(htmlSub.body.data).replace(
            /<script[^>]*>.*?<\/script>/gs,
            "",
          )
          return { body: html, bodyIsHtml: true }
        }
        const textSub = part.parts.find((p: any) => p.mimeType === "text/plain")
        if (textSub?.body?.data)
          return { body: decodeBase64Url(textSub.body.data), bodyIsHtml: false }
      }
    }
  }

  return { body: "", bodyIsHtml: false }
}

/**
 * Build a map of Content-ID → attachmentId for inline images.
 * Walks all MIME parts recursively to find image/* parts with a Content-ID header.
 */
function getInlineAttachments(payload: any): Map<string, { attachmentId: string; mimeType: string }> {
  const map = new Map<string, { attachmentId: string; mimeType: string }>()

  function walk(part: any) {
    if (part.mimeType?.startsWith("image/") && part.body?.attachmentId) {
      const cidHeader = part.headers?.find(
        (h: any) => h.name.toLowerCase() === "content-id",
      )
      if (cidHeader) {
        // Content-ID comes as "<image001.png@01DCB162.3A573F60>", strip angle brackets
        const cid = cidHeader.value.replace(/^<|>$/g, "")
        map.set(cid, { attachmentId: part.body.attachmentId, mimeType: part.mimeType })
      }
    }
    if (part.parts) part.parts.forEach(walk)
  }

  walk(payload)
  return map
}

/**
 * Replace cid: references in HTML with proxy URLs to our attachment endpoint.
 */
function replaceCidReferences(html: string, messageId: string, cidMap: Map<string, { attachmentId: string; mimeType: string }>): string {
  if (cidMap.size === 0) return html
  return html.replace(/src="cid:([^"]+)"/gi, (match, cid) => {
    const attachment = cidMap.get(cid)
    if (!attachment) return match
    return `src="/api/gmail/messages/${messageId}/attachments/${encodeURIComponent(attachment.attachmentId)}"`
  })
}

function parseMessage(message: any, sanitizeOpts?: SanitizeOptions) {
  const { body, bodyIsHtml } = getEmailBody(message)
  let cleanedBody = bodyIsHtml ? sanitizeHtmlEmail(body, sanitizeOpts) : sanitizePlainText(body)

  // Replace cid: inline image references with proxy URLs
  if (bodyIsHtml && message.payload) {
    const cidMap = getInlineAttachments(message.payload)
    cleanedBody = replaceCidReferences(cleanedBody, message.id, cidMap)
  }

  return {
    id: message.id,
    threadId: message.threadId,
    labelIds: message.labelIds || [],
    snippet: decodeHtmlEntities(message.snippet || ""),
    from: getHeader(message, "from"),
    to: getHeader(message, "to"),
    subject: getHeader(message, "subject"),
    date: getHeader(message, "date"),
    body: cleanedBody,
    bodyIsHtml,
    isUnread: (message.labelIds || []).includes("UNREAD"),
  }
}

export async function fetchBatched<T>(
  items: any[],
  fn: (item: any) => Promise<T>,
  batchSize = 5,
): Promise<T[]> {
  const results: T[] = []
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize)
    results.push(...(await Promise.all(chunk.map(fn))))
  }
  return results
}

function parseThreadSummary(thread: any) {
  const messages = thread.messages || []
  const firstMsg = messages[0]
  const lastMsg = messages[messages.length - 1]
  const allLabelIds = [...new Set(messages.flatMap((m: any) => m.labelIds || []))] as string[]
  return {
    id: thread.id,
    threadId: thread.id,
    historyId: thread.historyId,
    messageCount: messages.length,
    subject: getHeader(firstMsg, "subject"),
    from: getHeader(lastMsg, "from"),
    to: getHeader(firstMsg, "to"),
    date: getHeader(lastMsg, "date"),
    snippet: decodeHtmlEntities(firstMsg?.snippet || ""),
    isUnread: allLabelIds.includes("UNREAD"),
    labelIds: allLabelIds,
    body: "",
    bodyIsHtml: false,
  }
}

export async function getThreadSummary(threadId: string) {
  const params = new URLSearchParams([
    ["format", "metadata"],
    ["metadataHeaders", "From"],
    ["metadataHeaders", "To"],
    ["metadataHeaders", "Subject"],
    ["metadataHeaders", "Date"],
  ])
  const thread = await gmailRequest(`/threads/${threadId}?${params}`)
  return parseThreadSummary(thread)
}

export async function searchThreads(query: string, maxResults = 20, pageToken?: string) {
  const params = new URLSearchParams({ q: query, maxResults: String(maxResults) })
  if (pageToken) params.set("pageToken", pageToken)
  const listResult = await gmailRequest(`/threads?${params}`)

  if (!listResult.threads?.length) {
    return { threads: [], nextPageToken: null, historyId: listResult.historyId || null }
  }

  const threads = await fetchBatched(listResult.threads, (t: any) => getThreadSummary(t.id))

  return {
    threads,
    nextPageToken: listResult.nextPageToken || null,
    historyId: listResult.historyId || null,
  }
}

export async function getHistory(startHistoryId: string) {
  const params = new URLSearchParams({
    startHistoryId,
    historyTypes: "messageAdded,messageDeleted,labelAdded,labelRemoved",
    maxResults: "100",
  })
  return gmailRequest(`/history?${params}`)
}

export async function searchMessages(query: string, maxResults = 50, pageToken?: string) {
  const params = new URLSearchParams({
    q: query,
    maxResults: String(maxResults),
  })
  if (pageToken) params.set("pageToken", pageToken)
  const listResult = await gmailRequest(`/messages?${params}`)

  if (!listResult.messages?.length) {
    return { messages: [], nextPageToken: null }
  }

  const messages = await fetchBatched(listResult.messages, async (m: any) => {
    const full = await gmailRequest(`/messages/${m.id}?format=full`)
    return parseMessage(full)
  })

  return { messages, nextPageToken: listResult.nextPageToken || null }
}

export async function getMessage(messageId: string) {
  const full = await gmailRequest(`/messages/${messageId}?format=full`)
  return parseMessage(full, { keepSignature: true })
}

export async function getThread(threadId: string) {
  const thread = await gmailRequest(`/threads/${threadId}?format=full`)
  const rawMessages = thread.messages || []
  const messages = rawMessages.map((msg: any, i: number) =>
    parseMessage(msg, { keepSignature: i === rawMessages.length - 1 }),
  )
  const firstMessage = messages[0]

  return {
    id: thread.id,
    messages,
    subject: firstMessage?.subject || "",
    snippet: firstMessage?.snippet || "",
    from: firstMessage?.from || "",
    date: firstMessage?.date || "",
    messageCount: messages.length,
    isUnread: messages.some((m: any) => m.isUnread),
    labelIds: [...new Set(messages.flatMap((m: any) => m.labelIds))],
  }
}

export async function getLabels() {
  const result = await gmailRequest("/labels")
  return {
    labels: (result.labels || []).map((l: any) => ({
      id: l.id,
      name: l.name,
      type: l.type,
      messagesTotal: l.messagesTotal,
      messagesUnread: l.messagesUnread,
    })),
  }
}

export async function modifyLabels(
  messageId: string,
  addLabelIds: string[],
  removeLabelIds: string[],
) {
  return gmailRequest(`/messages/${messageId}/modify`, {
    method: "POST",
    body: JSON.stringify({ addLabelIds, removeLabelIds }),
  })
}

export async function getAttachment(messageId: string, attachmentId: string): Promise<Buffer> {
  const data = await gmailRequest(`/messages/${messageId}/attachments/${attachmentId}`)
  const base64 = data.data.replace(/-/g, "+").replace(/_/g, "/")
  return Buffer.from(base64, "base64")
}

export async function createDraft(
  to: string,
  subject: string,
  body: string,
  threadId?: string,
  inReplyTo?: string,
) {
  const headers: string[] = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "Content-Type: text/plain; charset=utf-8",
  ]
  if (inReplyTo) {
    headers.push(`In-Reply-To: ${inReplyTo}`)
    headers.push(`References: ${inReplyTo}`)
  }

  const rawMessage = [...headers, "", body].join("\r\n")
  const encodedMessage = Buffer.from(rawMessage)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")

  const draft: any = {
    message: { raw: encodedMessage },
  }
  if (threadId) {
    draft.message.threadId = threadId
  }

  return gmailRequest("/drafts", {
    method: "POST",
    body: JSON.stringify(draft),
  })
}
