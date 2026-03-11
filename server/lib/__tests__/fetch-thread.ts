/**
 * Test utility for fetching email thread data from the Gmail API.
 *
 * Usage in tests:
 *   const { messages } = await fetchThread("19beace60dce19c1")
 *   messages[0].rawBody  // raw HTML/text before sanitization
 *   messages[0].body     // sanitized body
 *   messages[0].bodyIsHtml
 *
 * Usage to save a fixture:
 *   await saveFixture("19beace60dce19c1")  // saves last message's raw body
 *   await saveFixture("19beace60dce19c1", 0)  // saves first message
 *
 * Requires credentials from ~/Github/hammies/hammies-agent/.env
 */

import { resolve } from "path"
import { writeFileSync, existsSync } from "fs"
import { fileURLToPath } from "url"
import { loadCredentials, getGoogleAccessToken } from "../credentials.js"
import { getEmailBody, getHeader } from "../gmail.js"
import { sanitizePlainText, sanitizeHtmlEmail } from "../email-sanitizer.js"

const __dirname = fileURLToPath(new URL(".", import.meta.url))
const FIXTURES_DIR = resolve(__dirname, "fixtures")
const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"

let initialized = false

function ensureCredentials() {
  if (!initialized) {
    loadCredentials(process.env.HOME + "/Github/hammies/hammies-agent")
    initialized = true
  }
}

async function gmailRequest(path: string) {
  ensureCredentials()
  const token = await getGoogleAccessToken()
  const res = await fetch(`${GMAIL_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Gmail API ${res.status}: ${text}`)
  }
  return res.json()
}

export interface ThreadMessage {
  id: string
  index: number
  from: string
  to: string
  subject: string
  date: string
  rawBody: string
  body: string
  bodyIsHtml: boolean
}

export interface ThreadData {
  id: string
  subject: string
  messageCount: number
  messages: ThreadMessage[]
}

/**
 * Fetch a thread from the Gmail API and return raw + sanitized bodies for each message.
 */
export async function fetchThread(threadId: string): Promise<ThreadData> {
  const thread = await gmailRequest(`/threads/${threadId}?format=full`)
  const rawMessages = thread.messages || []

  const messages: ThreadMessage[] = rawMessages.map((msg: any, index: number) => {
    const { body: rawBody, bodyIsHtml } = getEmailBody(msg)
    const isLast = index === rawMessages.length - 1
    const body = bodyIsHtml
      ? sanitizeHtmlEmail(rawBody, { keepSignature: isLast })
      : sanitizePlainText(rawBody)
    return {
      id: msg.id,
      index,
      from: getHeader(msg, "from"),
      to: getHeader(msg, "to"),
      subject: getHeader(msg, "subject"),
      date: getHeader(msg, "date"),
      rawBody,
      body,
      bodyIsHtml,
    }
  })

  return {
    id: thread.id,
    subject: messages[0]?.subject || "",
    messageCount: messages.length,
    messages,
  }
}

/**
 * Save a message's raw body as an HTML fixture file.
 * @param threadId - Gmail thread ID
 * @param messageIndex - Which message in the thread (default: last)
 * @returns The fixture file path
 */
export async function saveFixture(
  threadId: string,
  messageIndex?: number,
): Promise<string> {
  const thread = await fetchThread(threadId)
  const idx = messageIndex ?? thread.messages.length - 1
  const msg = thread.messages[idx]
  if (!msg) throw new Error(`No message at index ${idx} in thread ${threadId}`)

  const filename = `${threadId}.html`
  const filepath = resolve(FIXTURES_DIR, filename)
  writeFileSync(filepath, msg.rawBody, "utf-8")
  console.log(`Saved fixture: ${filename} (${msg.rawBody.length} bytes, isHtml: ${msg.bodyIsHtml})`)
  return filepath
}

/**
 * Check if a fixture exists for a given thread ID.
 */
export function fixtureExists(threadId: string): boolean {
  return existsSync(resolve(FIXTURES_DIR, `${threadId}.html`))
}
