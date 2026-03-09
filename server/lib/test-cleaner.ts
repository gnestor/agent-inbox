/**
 * Standalone cleaner test script.
 *
 * Usage:
 *   tsx server/lib/test-cleaner.ts <messageId>
 *   tsx server/lib/test-cleaner.ts <messageId> --raw   # dump raw Gmail HTML to stdout
 *
 * Fetches the raw Gmail body for a message, runs cleanHtmlEmail step-by-step,
 * and reports lengths + which patterns fired at each stage.
 *
 * Avoids the restart-server / inject-logs / open-browser cycle.
 */

import { loadCredentials, getGoogleAccessToken } from "./credentials.js"
import { resolve } from "path"
import { homedir } from "os"

// Same default workspace as the server
const workspacePath = resolve(homedir(), "Github/hammies/hammies-agent")
loadCredentials(workspacePath)

const messageId = process.argv[2]
const dumpRaw = process.argv.includes("--raw")

if (!messageId) {
  console.error("Usage: tsx server/lib/test-cleaner.ts <messageId> [--raw]")
  process.exit(1)
}

// ── Fetch raw Gmail message ──────────────────────────────────────────────────

async function fetchRaw(id: string) {
  const token = await getGoogleAccessToken()
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) throw new Error(`Gmail API ${res.status}: ${await res.text()}`)
  return res.json()
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8")
}

function getHtmlBody(payload: any): string | null {
  if (payload.body?.data && payload.mimeType === "text/html")
    return decodeBase64Url(payload.body.data)
  if (payload.parts) {
    for (const part of payload.parts) {
      const found = getHtmlBody(part)
      if (found) return found
    }
  }
  return null
}

// ── Verbose cleaner (mirrors cleanHtmlEmail with step logging) ───────────────

import { cleanHtmlEmail } from "./email-cleaner.js"

const T = "(?:[^<]|<[^>]+>)"
const PATTERNS: Array<[string, RegExp]> = [
  ["发件人", new RegExp(`发件人(?:<[^>]*>)*[:：]`)],
  ["写道", new RegExp(`\\d{4}年\\d+月\\d+日${T}{0,80}写道(?:<[^>]*>)*[:：]`)],
  [
    "On...wrote",
    new RegExp(
      `\\bOn\\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)${T}{5,400}wrote:`,
    ),
  ],
  [
    "boldFrom/Date",
    new RegExp(
      `<(?:b|strong)>(?:[^<]|<[^>]+>){0,20}From:\\s*(?:[^<]|<[^>]+>){0,20}<\\/(?:b|strong)>(?:[^<]|<[^>]+>){0,400}<(?:b|strong)>(?:[^<]|<[^>]+>){0,20}(?:Sent|Date):`,
    ),
  ],
  ["---separator---", /-{5,}(?:Original|Forwarded) Message-{5,}/i],
]

function findBlockStart(html: string, pos: number): number {
  const blockTagRe = /<(?:div|p|table|tr|td|blockquote|article|section|hr)[^>]*>/gi
  const matches = [...html.slice(0, pos).matchAll(blockTagRe)]
  return matches.length > 0 ? matches[matches.length - 1].index! : pos
}

function verboseClean(html: string) {
  const step = (label: string, before: string, after: string) => {
    if (before.length !== after.length)
      console.log(
        `  ${label}: ${before.length} → ${after.length} (-${before.length - after.length})`,
      )
  }

  let r = html
  console.log(`\nInput: ${r.length} chars`)

  const sw = r.slice(0, r.search(/<div[^>]*class="[^"]*shortwave-signature[^"]*"/i) || r.length)
  step("shortwave-signature", r, sw)
  if (sw.length < r.length) r = sw

  const gm = r.slice(
    0,
    r.search(/<div[^>]*class="[^"]*gmail_(?:quote|extra)[^"]*"/i) > 0
      ? r.search(/<div[^>]*class="[^"]*gmail_(?:quote|extra)[^"]*"/i)
      : r.length,
  )
  step("gmail_quote/extra", r, gm)
  if (gm.length < r.length) r = gm

  const ol = r.search(/<div[^>]*id="divRplyFwdMsg"/i)
  if (ol > 0) {
    step("Outlook divRplyFwdMsg", r, r.slice(0, ol))
    r = r.slice(0, ol)
  }

  const hr = r.search(/<hr[^>]*tabindex="-1"[^>]*>/i)
  if (hr > 0) {
    const cut = findBlockStart(r, hr)
    step("Outlook <hr tabindex=-1>", r, r.slice(0, cut))
    r = r.slice(0, cut)
  }

  let prev = r
  do {
    prev = r
    r = r.replace(/<blockquote[\s\S]*?<\/blockquote>/gi, "")
  } while (r !== prev)
  step(
    "blockquote removal",
    html.slice(0, prev.length > html.length ? html.length : prev.length),
    r,
  )

  const ubq = r.search(/<blockquote[^>]*>/i)
  if (ubq > 0) {
    const cut = findBlockStart(r, ubq)
    step("unclosed blockquote", r, r.slice(0, cut))
    r = r.slice(0, cut)
  }

  const attrBefore = r
  r = r.replace(/<div[^>]*class="[^"]*gmail_attr[^"]*"[^>]*>[\s\S]*?<\/div>/gi, "")
  step("gmail_attr", attrBefore, r)

  console.log(`\nPre-text-pattern: ${r.length} chars`)
  let earliest = Infinity,
    bestName = "",
    bestIdx = -1
  for (const [name, pattern] of PATTERNS) {
    const m = r.match(pattern)
    if (m?.index && m.index > 0) {
      console.log(`  [MATCH] ${name} at index ${m.index}`)
      if (m.index < earliest) {
        earliest = m.index
        bestName = name
        bestIdx = m.index
      }
    } else {
      console.log(`  [    ] ${name}`)
    }
  }
  if (bestIdx > 0) {
    const cut = findBlockStart(r, bestIdx)
    console.log(`\n  → Using "${bestName}" match at ${bestIdx}, cutting at block boundary ${cut}`)
    r = r.slice(0, cut)
  }

  console.log(`\nPost-text-pattern: ${r.length} chars`)
  const finalActual = cleanHtmlEmail(html)
  console.log(`Actual cleanHtmlEmail output: ${finalActual.length} chars`)
  if (r.length !== finalActual.length) {
    console.log(
      `  (difference of ${Math.abs(r.length - finalActual.length)} from signature/blank cleanup)`,
    )
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

const message = await fetchRaw(messageId)
const html = getHtmlBody(message.payload)

if (!html) {
  console.log("No HTML body found for message", messageId)
  process.exit(0)
}

if (dumpRaw) {
  process.stdout.write(html)
  process.exit(0)
}

verboseClean(html)
