/**
 * Live Gmail integration tests for email sanitization.
 *
 * These tests fetch real threads from the Gmail API and verify sanitization.
 * Skipped by default (no credentials in CI). Run explicitly:
 *
 *   npx vitest run server/lib/__tests__/email-sanitizer-live.test.ts
 *
 * To debug a specific thread:
 *   THREAD_ID=19beace60dce19c1 npx vitest run server/lib/__tests__/email-sanitizer-live.test.ts
 *
 * To save a fixture for offline tests:
 *   SAVE_FIXTURE=1 THREAD_ID=19beace60dce19c1 npx vitest run server/lib/__tests__/email-sanitizer-live.test.ts
 */

import { describe, it, expect } from "vitest"
import { fetchThread, saveFixture, type ThreadMessage } from "./fetch-thread.js"

const canConnect = (() => {
  try {
    const { existsSync } = require("fs")
    const { resolve } = require("path")
    return existsSync(resolve(process.env.HOME!, "Github/hammies/hammies-agent/.env"))
  } catch {
    return false
  }
})()

const describeGmail = canConnect ? describe : describe.skip

// ─── Debug: inspect a specific thread ─────────────────────────────────────────
// Set THREAD_ID env var to inspect any thread's sanitization pipeline.

const debugThreadId = process.env.THREAD_ID

if (debugThreadId) {
  describe(`debug thread ${debugThreadId}`, () => {
    it("fetches and displays sanitization results", async () => {
      const thread = await fetchThread(debugThreadId)
      console.log(`\nThread: ${thread.subject} (${thread.messageCount} messages)\n`)

      for (const msg of thread.messages) {
        console.log(`── Message ${msg.index} (${msg.id}) ──`)
        console.log(`  From: ${msg.from}`)
        console.log(`  Date: ${msg.date}`)
        console.log(`  bodyIsHtml: ${msg.bodyIsHtml}`)
        console.log(`  Raw body: ${msg.rawBody.length} chars`)
        console.log(`  Sanitized: ${msg.body.length} chars (${pct(msg.body.length, msg.rawBody.length)}%)`)
        if (msg.bodyIsHtml) {
          console.log(`  Reduction: ${pct(msg.rawBody.length - msg.body.length, msg.rawBody.length)}%`)
        }
        console.log(`  Preview: ${preview(msg.body, msg.bodyIsHtml)}`)
        console.log()
      }

      if (process.env.SAVE_FIXTURE) {
        const idx = process.env.MSG_INDEX ? parseInt(process.env.MSG_INDEX) : undefined
        await saveFixture(debugThreadId, idx)
      }

      // Always pass — this is a debug/inspection test
      expect(thread.messages.length).toBeGreaterThan(0)
    }, 30_000)
  })
}

// ─── Live sanitization tests for known threads ────────────────────────────────

describeGmail("live Gmail sanitization", () => {
  it("19beace60dce19c1: GoHighLevel reply-timestamp-box stripped", async () => {
    const thread = await fetchThread("19beace60dce19c1")
    const last = thread.messages[thread.messages.length - 1]

    expect(last.bodyIsHtml).toBe(true)
    expect(last.body).toContain("Just wanted to check in one more time")
    expect(last.body).not.toContain("Just circling back")
    expect(last.body).not.toMatch(/class="[^"]*reply-timestamp-box/)
    expect(last.body.length).toBeLessThan(last.rawBody.length * 0.5)
  }, 15_000)

  it("1975c3797eaec1c5: inspect message bodyIsHtml flags", async () => {
    const thread = await fetchThread("1975c3797eaec1c5")
    const secondToLast = thread.messages[thread.messages.length - 2]

    console.log(`\nThread: ${thread.subject} (${thread.messageCount} messages)`)
    for (const msg of thread.messages) {
      console.log(
        `  [${msg.index}] ${msg.id} bodyIsHtml=${msg.bodyIsHtml} raw=${msg.rawBody.length} sanitized=${msg.body.length} from=${msg.from.slice(0, 40)}`,
      )
    }

    // The second-to-last message should be sanitized (no quoted content leaking through)
    expect(secondToLast).toBeDefined()
    expectNoQuotedContent(secondToLast)
  }, 15_000)

  it("19491ac0c7f23645: Shortwave signature stripped", async () => {
    const thread = await fetchThread("19491ac0c7f23645")
    const last = thread.messages[thread.messages.length - 1]

    expect(last.body).not.toMatch(/class="[^"]*shortwave-signature/)
    expect(last.body.length).toBeLessThan(last.rawBody.length * 0.6)
  }, 15_000)

})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pct(part: number, whole: number): string {
  if (whole === 0) return "0"
  return Math.round((part / whole) * 100).toString()
}

function preview(body: string, isHtml: boolean): string {
  const text = isHtml ? body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : body
  return text.slice(0, 120) + (text.length > 120 ? "…" : "")
}

function expectNoQuotedContent(msg: ThreadMessage) {
  // Common quoted-content indicators that should be stripped
  expect(msg.body).not.toMatch(/class="[^"]*reply-timestamp-box/)
  expect(msg.body).not.toMatch(/class="[^"]*gmail_quote/)
  expect(msg.body).not.toMatch(/class="[^"]*gmail_extra/)
  expect(msg.body).not.toMatch(/<blockquote/)
}
