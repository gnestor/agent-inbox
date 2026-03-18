import { sanitizePlainText, sanitizeHtmlEmail, type SanitizeOptions } from "./email-sanitizer.js"

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"

async function gmailRequest(accessToken: string, path: string, options?: RequestInit) {
  const res = await fetch(`${GMAIL_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
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
 * Collect non-inline file attachments from a message payload.
 * Excludes inline images (which have a Content-ID header and are image/*).
 */
export function getAttachments(payload: any): { attachmentId: string; filename: string; mimeType: string; size: number }[] {
  const attachments: { attachmentId: string; filename: string; mimeType: string; size: number }[] = []

  function walk(part: any) {
    if (part.filename && part.body?.attachmentId) {
      // Skip inline images (have Content-ID header and are image/*)
      const hasCid = part.headers?.some((h: any) => h.name.toLowerCase() === "content-id")
      const isImage = part.mimeType?.startsWith("image/")
      if (!(hasCid && isImage)) {
        attachments.push({
          attachmentId: part.body.attachmentId,
          filename: part.filename,
          mimeType: part.mimeType || "application/octet-stream",
          size: part.body.size || 0,
        })
      }
    }
    if (part.parts) part.parts.forEach(walk)
  }

  walk(payload)
  return attachments
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
    attachments: message.payload ? getAttachments(message.payload) : [],
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

export async function getThreadSummary(accessToken: string, threadId: string) {
  const params = new URLSearchParams([
    ["format", "metadata"],
    ["metadataHeaders", "From"],
    ["metadataHeaders", "To"],
    ["metadataHeaders", "Subject"],
    ["metadataHeaders", "Date"],
  ])
  const thread = await gmailRequest(accessToken, `/threads/${threadId}?${params}`)
  return parseThreadSummary(thread)
}

export async function searchThreads(accessToken: string, query: string, maxResults = 20, pageToken?: string) {
  const params = new URLSearchParams({ q: query, maxResults: String(maxResults) })
  if (pageToken) params.set("pageToken", pageToken)
  const listResult = await gmailRequest(accessToken, `/threads?${params}`)

  if (!listResult.threads?.length) {
    return { threads: [], nextPageToken: null, historyId: listResult.historyId || null }
  }

  const threads = await fetchBatched(listResult.threads, (t: any) => getThreadSummary(accessToken, t.id))

  return {
    threads,
    nextPageToken: listResult.nextPageToken || null,
    historyId: listResult.historyId || null,
  }
}

export async function getHistory(accessToken: string, startHistoryId: string) {
  const params = new URLSearchParams({
    startHistoryId,
    historyTypes: "messageAdded,messageDeleted,labelAdded,labelRemoved",
    maxResults: "100",
  })
  return gmailRequest(accessToken, `/history?${params}`)
}

export async function searchMessages(accessToken: string, query: string, maxResults = 50, pageToken?: string) {
  const params = new URLSearchParams({
    q: query,
    maxResults: String(maxResults),
  })
  if (pageToken) params.set("pageToken", pageToken)
  const listResult = await gmailRequest(accessToken, `/messages?${params}`)

  if (!listResult.messages?.length) {
    return { messages: [], nextPageToken: null }
  }

  const messages = await fetchBatched(listResult.messages, async (m: any) => {
    const full = await gmailRequest(accessToken, `/messages/${m.id}?format=full`)
    return parseMessage(full)
  })

  return { messages, nextPageToken: listResult.nextPageToken || null }
}

export async function getMessage(accessToken: string, messageId: string) {
  const full = await gmailRequest(accessToken, `/messages/${messageId}?format=full`)
  return parseMessage(full, { keepSignature: true })
}

export async function getThread(accessToken: string, threadId: string) {
  const thread = await gmailRequest(accessToken, `/threads/${threadId}?format=full`)
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

export async function getLabels(accessToken: string) {
  const result = await gmailRequest(accessToken, "/labels")
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
  accessToken: string,
  messageId: string,
  addLabelIds: string[],
  removeLabelIds: string[],
) {
  return gmailRequest(accessToken, `/messages/${messageId}/modify`, {
    method: "POST",
    body: JSON.stringify({ addLabelIds, removeLabelIds }),
  })
}

export async function trashThread(accessToken: string, threadId: string) {
  return gmailRequest(accessToken, `/threads/${threadId}/trash`, { method: "POST" })
}

export async function modifyThreadLabels(
  accessToken: string,
  threadId: string,
  addLabelIds: string[],
  removeLabelIds: string[],
) {
  return gmailRequest(accessToken, `/threads/${threadId}/modify`, {
    method: "POST",
    body: JSON.stringify({ addLabelIds, removeLabelIds }),
  })
}

export async function getSignature(accessToken: string): Promise<string> {
  const data = await gmailRequest(accessToken, "/settings/sendAs")
  const primary = data.sendAs?.find((s: any) => s.isPrimary)
  return primary?.signature || ""
}

function buildRawEmail(
  to: string,
  subject: string,
  body: string,
  signature: string,
  inReplyTo?: string,
): string {
  if (signature) {
    // Send as multipart HTML so the signature renders correctly
    const htmlBody = `<div>${body.replace(/\n/g, "<br>")}</div><br><div class="gmail_signature">${signature}</div>`
    const boundary = `boundary_${Date.now()}`
    const headers: string[] = [
      `To: ${to}`,
      `Subject: ${subject}`,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ]
    if (inReplyTo) {
      headers.push(`In-Reply-To: ${inReplyTo}`)
      headers.push(`References: ${inReplyTo}`)
    }
    const parts = [
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      body,
      `--${boundary}`,
      "Content-Type: text/html; charset=utf-8",
      "",
      htmlBody,
      `--${boundary}--`,
    ]
    return [...headers, "", ...parts].join("\r\n")
  }

  // Plain text (no signature)
  const headers: string[] = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "Content-Type: text/plain; charset=utf-8",
  ]
  if (inReplyTo) {
    headers.push(`In-Reply-To: ${inReplyTo}`)
    headers.push(`References: ${inReplyTo}`)
  }
  return [...headers, "", body].join("\r\n")
}

function encodeRaw(raw: string): string {
  return Buffer.from(raw)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

export async function sendMessage(
  accessToken: string,
  to: string,
  subject: string,
  body: string,
  threadId?: string,
  inReplyTo?: string,
  signature?: string,
) {
  const rawMessage = buildRawEmail(to, subject, body, signature || "", inReplyTo)
  const message: any = { raw: encodeRaw(rawMessage) }
  if (threadId) message.threadId = threadId

  return gmailRequest(accessToken, "/messages/send", {
    method: "POST",
    body: JSON.stringify(message),
  })
}

export async function getAttachment(accessToken: string, messageId: string, attachmentId: string): Promise<Buffer> {
  const data = await gmailRequest(accessToken, `/messages/${messageId}/attachments/${attachmentId}`)
  const base64 = data.data.replace(/-/g, "+").replace(/_/g, "/")
  return Buffer.from(base64, "base64")
}

export async function createDraft(
  accessToken: string,
  to: string,
  subject: string,
  body: string,
  threadId?: string,
  inReplyTo?: string,
  signature?: string,
) {
  const rawMessage = buildRawEmail(to, subject, body, signature || "", inReplyTo)
  const draft: any = {
    message: { raw: encodeRaw(rawMessage) },
  }
  if (threadId) {
    draft.message.threadId = threadId
  }

  return gmailRequest(accessToken, "/drafts", {
    method: "POST",
    body: JSON.stringify(draft),
  })
}
