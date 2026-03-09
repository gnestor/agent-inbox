/**
 * Strips quoted reply history and app signatures from email bodies.
 * Applied server-side in parseMessage() so clean content is cached.
 *
 * Strategy:
 *  1. For HTML: remove known structural quote wrappers (gmail_quote, shortwave-signature,
 *     blockquotes), then fall back to text-pattern scanning of the raw HTML string.
 *  2. For plain text: scan lines for known attribution/header patterns and truncate.
 */

/** Email client app name footers that appear on their own line */
const APP_SIGNATURE_RE = /^(Shortwave|Superhuman|Spark|Hey|Fastmail|Newton|Airmail|Front|Missive)$/i

// ─── Plain Text ──────────────────────────────────────────────────────────────

export function cleanPlainText(text: string): string {
  // Normalize CRLF (Outlook, Chinese clients use \r\n)
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")
  const result: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim()

    // Stop at ">"-prefixed quoted lines
    if (t.startsWith(">")) break

    // Stop at "On ... wrote:" attribution (up to 3 lines for line-wrapped variants)
    // Handles both "On Mon Apr 21..." (Shortwave) and "On Thu, Feb 19, 2026 at 4:25 PM" (Gmail)
    const ahead3 = lines
      .slice(i, i + 3)
      .map((l) => l.trim())
      .join(" ")
    if (/^On\s.+\bwrote:/.test(ahead3)) break

    // Stop at Chinese "wrote:" attribution (e.g. "2025年9月5日 01:14，Kevin Mahany 写道：")
    if (/\d{4}年\d+月\d+日.+写道[:：]/.test(t)) break

    // Stop at Outlook reply/forward header block ("From: ... Sent: ..." within 5 lines)
    if (/^From:\s/.test(t)) {
      const ahead5 = lines
        .slice(i, i + 5)
        .map((l) => l.trim())
        .join("\n")
      if (/^(Sent|Date):/m.test(ahead5)) break
    }

    // Stop at Chinese Outlook header — supports both regular (:) and full-width (：) colon
    if (/^发件人[:：]/.test(t)) break

    // Stop at Outlook "-----Original Message-----" separator
    if (/^-{5,}(Original|Forwarded) Message-{5,}/i.test(t)) break

    // Stop at Outlook security disclaimers injected before quoted content
    if (/^Caution:\s*EXTERNAL/i.test(t)) break

    // Skip "Sent with/via [App]" footers — remove line but don't truncate
    if (/^Sent (?:with|via) \S/i.test(t)) continue

    // Skip standalone known app name footers
    if (APP_SIGNATURE_RE.test(t)) continue

    result.push(lines[i])
  }

  return result
    .join("\n")
    .replace(/<[^>]+>/g, "")
    .trimEnd()
}

// ─── HTML ─────────────────────────────────────────────────────────────────────

/**
 * Patterns that appear as plain text within HTML quote attribution elements.
 * Fallback for email clients that don't use recognized structural wrappers.
 * Ordered from most to least specific.
 *
 * Uses (?:[^<]|<[^>]+>) to match text with optional interspersed HTML tags,
 * since Outlook and Apple Mail split attribution text across multiple <span> elements.
 */

/** Matches any character that isn't the start of an HTML tag, or a complete HTML tag */
const T = "(?:[^<]|<[^>]+>)" // "text or tag" unit for tag-permissive patterns

const HTML_TEXT_QUOTE_PATTERNS: RegExp[] = [
  // Chinese Outlook header — colon may be in a sibling <span> (e.g. <span>发件人</span><span lang=EN-US>:</span>)
  new RegExp(`发件人(?:<[^>]*>)*[:：]`),
  // Chinese "wrote:" attribution (e.g. "2025年9月5日 01:14，Kevin Mahany 写道：")
  new RegExp(`\\d{4}年\\d+月\\d+日${T}{0,80}写道(?:<[^>]*>)*[:：]`),
  // Standard "On [month or weekday] ... wrote:" — text may span multiple <span> elements
  // Handles both "On Mon Apr 21..." (weekday-first) and "On Jan 27..." (month-first)
  new RegExp(
    `\\bOn\\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)${T}{5,400}wrote:`,
  ),
  // Bold reply header: bold "From:" followed by bold "Sent:" or "Date:" within ~400 chars
  // Outlook: <b><span>From:</span></b> ... <b>Sent:</b>
  // Apple Mail / iOS: <b><span>From: </span></b> ... <b>Date: </b>
  new RegExp(
    `<(?:b|strong)>(?:[^<]|<[^>]+>){0,20}From:\\s*(?:[^<]|<[^>]+>){0,20}<\\/(?:b|strong)>(?:[^<]|<[^>]+>){0,400}<(?:b|strong)>(?:[^<]|<[^>]+>){0,20}(?:Sent|Date):`,
  ),
  // Outlook original/forwarded message separator
  /-{5,}(?:Original|Forwarded) Message-{5,}/i,
]

/**
 * Find the start of the enclosing block-level element before position `pos`.
 * Falls back to `pos` itself if no block element is found.
 */
function findBlockStart(html: string, pos: number): number {
  const blockTagRe = /<(?:div|p|table|tr|td|blockquote|article|section|hr)[^>]*>/gi
  const matches = [...html.slice(0, pos).matchAll(blockTagRe)]
  return matches.length > 0 ? matches[matches.length - 1].index! : pos
}

export function cleanHtmlEmail(html: string): string {
  let result = html

  // ── Structural truncations (fast path for common clients) ──────────────────

  // Shortwave: signature div always precedes attribution + quoted history
  const swIdx = result.search(/<div[^>]*class="[^"]*shortwave-signature[^"]*"/i)
  if (swIdx > 0) result = result.slice(0, swIdx)

  // Gmail: quote/extra wrapper
  const gmailIdx = result.search(/<div[^>]*class="[^"]*gmail_(?:quote|extra)[^"]*"/i)
  if (gmailIdx > 0) result = result.slice(0, gmailIdx)

  // Outlook: reply/forward div and the <hr tabindex="-1"> separator that precedes it
  const outlookIdx = result.search(/<div[^>]*id="divRplyFwdMsg"/i)
  if (outlookIdx > 0) result = result.slice(0, outlookIdx)

  // Outlook: standalone <hr tabindex="-1"> separator (left behind after divRplyFwdMsg removal)
  const outlookHrIdx = result.search(/<hr[^>]*tabindex="-1"[^>]*>/i)
  if (outlookHrIdx > 0) result = result.slice(0, findBlockStart(result, outlookHrIdx))

  // ── Blockquote removal (loop removes innermost first, handles nesting) ─────

  // Match only the innermost blockquotes (no nested <blockquote> inside).
  // The negative lookahead prevents matching an outer opening tag paired
  // with an inner closing tag, which leaves a dangling </blockquote>.
  let prev: string
  do {
    prev = result
    result = result.replace(/<blockquote[^>]*>(?:(?!<\/?blockquote)[\s\S])*?<\/blockquote>/gi, "")
  } while (result !== prev)

  // Handle unclosed blockquotes (Apple Mail omits closing tags) — truncate there
  const unclosedBq = result.search(/<blockquote[^>]*>/i)
  if (unclosedBq > 0) result = result.slice(0, findBlockStart(result, unclosedBq))

  // Gmail attribution div ("On ... wrote:" wrapper)
  result = result.replace(/<div[^>]*class="[^"]*gmail_attr[^"]*"[^>]*>[\s\S]*?<\/div>/gi, "")

  // ── Text-pattern fallback (handles Apple Mail / Outlook / Chinese clients) ──
  // Scan for attribution text still present in the HTML after structural cleanup.

  // Find the earliest-matching pattern (lowest index) so a nested attribution
  // deeper in the thread doesn't shadow a header closer to the reply boundary.
  let earliestIndex = Infinity
  let earliestMatchIndex: number | null = null
  for (const pattern of HTML_TEXT_QUOTE_PATTERNS) {
    const match = result.match(pattern)
    if (process.env.DEBUG_CLEANER)
      console.log(`[cleaner] pattern ${pattern} → index=${match?.index}`)
    if (match?.index && match.index > 0 && match.index < earliestIndex) {
      earliestIndex = match.index
      earliestMatchIndex = match.index
    }
  }
  if (earliestMatchIndex !== null) {
    const cutAt = findBlockStart(result, earliestMatchIndex)
    if (process.env.DEBUG_CLEANER)
      console.log(`[cleaner] cutting at ${cutAt}, result was ${result.length}`)
    result = result.slice(0, cutAt)
  }

  // ── Signature line cleanup ─────────────────────────────────────────────────

  result = result.replace(/<[a-z][a-z0-9]*[^>]*>\s*Sent (?:with|via) [^<]+<\/[a-z][a-z0-9]*>/gi, "")
  result = result.replace(/Sent (?:with|via) \S[^\n<]*/gi, "")

  // Remove standalone app name elements (e.g. <span style="color:#4C8AFF">Shortwave</span>)
  result = result.replace(
    /<[^>]+>\s*(?:Shortwave|Superhuman|Spark|Hey|Fastmail|Newton|Airmail|Front|Missive)\s*<\/[^>]+>/gi,
    "",
  )

  // ── Trailing empty block elements (Outlook/Word nbsp padding) ──────────────
  // Remove <p> and <div> elements whose visible content is only whitespace / &nbsp;
  // (possibly wrapped in <span> elements). Repeat until stable.

  // Matches blank <p>/<div> whose visible content is only whitespace, &nbsp;, or inline tags
  // (including nested: <span><o:p>&nbsp;</o:p></span>). Excludes <img> to avoid removing images.
  const BLANK_BLOCK = /<(?:p|div)[^>]*>(?:\s|&nbsp;|<(?!\/?img\b)[^>]+>)*<\/(?:p|div)>/g
  let prev2: string
  do {
    prev2 = result
    result = result.replace(BLANK_BLOCK, "")
  } while (result !== prev2)

  return result.trimEnd()
}
