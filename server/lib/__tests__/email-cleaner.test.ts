import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { resolve } from "path"
import { fileURLToPath } from "url"
import { cleanPlainText, cleanHtmlEmail } from "../email-cleaner.js"

const __dirname = fileURLToPath(new URL(".", import.meta.url))
function fixture(filename: string) {
  return readFileSync(resolve(__dirname, "fixtures", filename), "utf-8")
}

// ─── cleanPlainText ───────────────────────────────────────────────────────────

describe("cleanPlainText", () => {
  it("passes through plain text with no quotes", () => {
    expect(cleanPlainText("Hello world")).toBe("Hello world")
  })

  it("returns empty string for empty input", () => {
    expect(cleanPlainText("")).toBe("")
  })

  it("normalizes CRLF line endings", () => {
    expect(cleanPlainText("Line 1\r\nLine 2")).toBe("Line 1\nLine 2")
  })

  it("normalizes bare CR line endings", () => {
    expect(cleanPlainText("Line 1\rLine 2")).toBe("Line 1\nLine 2")
  })

  it("trims trailing whitespace and blank lines", () => {
    expect(cleanPlainText("Hello\n\n   ")).toBe("Hello")
  })

  // ── Quoted-line detection ──────────────────────────────────────────────────

  it('stops at ">" quoted line', () => {
    expect(cleanPlainText("My reply\n> Original text")).toBe("My reply")
  })

  it("strips everything after the first quoted line", () => {
    expect(cleanPlainText("Thanks\n> wrote:\n> original")).toBe("Thanks")
  })

  // ── "On … wrote:" attribution ─────────────────────────────────────────────

  it('stops at single-line "On … wrote:" attribution', () => {
    const input =
      "Thanks!\n\nOn Mon, Apr 21, 2025 at 10:00 AM John Smith <john@example.com> wrote:\n> Original"
    expect(cleanPlainText(input)).toBe("Thanks!")
  })

  it('stops at "On … wrote:" split across up to 3 lines (Gmail wrap)', () => {
    const input =
      "Thanks!\n\nOn Mon, Apr 21, 2025 at 10:00 AM\nJohn Smith <john@example.com>\nwrote:\n> Original"
    expect(cleanPlainText(input)).toBe("Thanks!")
  })

  it('stops at "On Thu, Feb 19" format (Gmail style)', () => {
    const input =
      "Sounds good\n\nOn Thu, Feb 19, 2026 at 4:25 PM Alice <alice@example.com> wrote:\n> previous"
    expect(cleanPlainText(input)).toBe("Sounds good")
  })

  // ── Chinese attribution ────────────────────────────────────────────────────

  it("stops at Chinese 写道： attribution", () => {
    const input = "好的\n\n2025年9月5日 01:14，Kevin Mahany 写道：\n> message"
    expect(cleanPlainText(input)).toBe("好的")
  })

  it("stops at Chinese 写道: attribution (ASCII colon)", () => {
    const input = "回复\n\n2025年11月20日 10:30，Alice 写道:\n> message"
    expect(cleanPlainText(input)).toBe("回复")
  })

  // ── Outlook attribution ────────────────────────────────────────────────────

  it('stops at Outlook "From: … Sent:" header block', () => {
    const input =
      "My reply\n\nFrom: John Smith <john@example.com>\nSent: Monday, April 21, 2025 10:00 AM\nTo: Me"
    expect(cleanPlainText(input)).toBe("My reply")
  })

  it('stops at Outlook "From: … Date:" header block', () => {
    const input = "My reply\n\nFrom: john@example.com\nDate: 21 Apr 2025\nSubject: Re: Test"
    expect(cleanPlainText(input)).toBe("My reply")
  })

  it("stops at Chinese Outlook 发件人： header (full-width colon)", () => {
    const input = "回复内容\n\n发件人：John Smith\n发送时间：2025年9月5日"
    expect(cleanPlainText(input)).toBe("回复内容")
  })

  it("stops at Chinese Outlook 发件人: header (ASCII colon)", () => {
    const input = "回复内容\n\n发件人: John Smith"
    expect(cleanPlainText(input)).toBe("回复内容")
  })

  it('stops at "-----Original Message-----" separator', () => {
    const input = "My reply\n\n-----Original Message-----\nFrom: john@example.com"
    expect(cleanPlainText(input)).toBe("My reply")
  })

  it('stops at "-----Forwarded Message-----" separator', () => {
    const input = "My reply\n\n-----Forwarded Message-----\nContent"
    expect(cleanPlainText(input)).toBe("My reply")
  })

  // ── Security disclaimers ───────────────────────────────────────────────────

  it('stops at "Caution: EXTERNAL" security disclaimer', () => {
    const input = "My reply\n\nCaution: EXTERNAL EMAIL - Do not click links"
    expect(cleanPlainText(input)).toBe("My reply")
  })

  // ── App footers (skip, don't break) ───────────────────────────────────────

  it('skips "Sent with X" line but continues processing subsequent lines', () => {
    const input = "My reply\nSent with Shortwave\nMore content"
    expect(cleanPlainText(input)).toBe("My reply\nMore content")
  })

  it('skips "Sent via X" line but continues processing subsequent lines', () => {
    const input = "My reply\nSent via Spark\nMore content"
    expect(cleanPlainText(input)).toBe("My reply\nMore content")
  })

  it("skips standalone Shortwave line but continues", () => {
    const input = "My reply\nShortwave\nMore content"
    expect(cleanPlainText(input)).toBe("My reply\nMore content")
  })

  it("skips all known app name footers", () => {
    const apps = ["Superhuman", "Spark", "Hey", "Fastmail", "Newton", "Airmail", "Front", "Missive"]
    for (const app of apps) {
      expect(cleanPlainText(`Reply\n${app}\nEnd`)).toBe("Reply\nEnd")
    }
  })

  it("app name matching is case-insensitive", () => {
    expect(cleanPlainText("Reply\nSHORTWAVE\nEnd")).toBe("Reply\nEnd")
  })

  // ── HTML tag stripping ─────────────────────────────────────────────────────

  it("strips residual HTML tags from plain-text content", () => {
    expect(cleanPlainText("Hello <b>world</b>")).toBe("Hello world")
  })
})

// ─── cleanHtmlEmail ───────────────────────────────────────────────────────────

describe("cleanHtmlEmail", () => {
  it("passes through HTML with no quotes", () => {
    const html = "<p>Hello world</p>"
    expect(cleanHtmlEmail(html)).toBe("<p>Hello world</p>")
  })

  it("returns empty string for empty input", () => {
    expect(cleanHtmlEmail("")).toBe("")
  })

  // ── Structural fast-paths ──────────────────────────────────────────────────

  it("removes shortwave-signature div and everything after", () => {
    const html =
      '<p>My reply</p><div class="shortwave-signature">Sent with Shortwave</div><p>Old message</p>'
    expect(cleanHtmlEmail(html)).toBe("<p>My reply</p>")
  })

  it("removes gmail_quote div and everything after", () => {
    const html = '<p>My reply</p><div class="gmail_quote"><p>Old message</p></div>'
    expect(cleanHtmlEmail(html)).toBe("<p>My reply</p>")
  })

  it("removes gmail_extra div and everything after", () => {
    const html = '<p>My reply</p><div class="gmail_extra"><p>Old message</p></div>'
    expect(cleanHtmlEmail(html)).toBe("<p>My reply</p>")
  })

  it("removes Outlook divRplyFwdMsg and everything after", () => {
    const html = '<p>My reply</p><div id="divRplyFwdMsg"><p>Old message</p></div>'
    expect(cleanHtmlEmail(html)).toBe("<p>My reply</p>")
  })

  it("removes Outlook <hr tabindex=-1> separator and everything after", () => {
    const html = '<p>My reply</p><div><hr tabindex="-1"><p>Old header</p></div>'
    const result = cleanHtmlEmail(html)
    expect(result).toContain("My reply")
    expect(result).not.toContain('tabindex="-1"')
    expect(result).not.toContain("Old header")
  })

  it("does NOT strip when gmail_quote is at position 0 (whole-email edge case)", () => {
    const html = '<div class="gmail_quote">All quoted</div>'
    expect(cleanHtmlEmail(html)).toContain("All quoted")
  })

  // ── Blockquote removal ─────────────────────────────────────────────────────

  it("removes blockquotes", () => {
    const html = "<p>My reply</p><blockquote>Old message</blockquote>"
    expect(cleanHtmlEmail(html)).toBe("<p>My reply</p>")
  })

  it("removes nested blockquotes (loop unwinds innermost first)", () => {
    const html = "<p>My reply</p><blockquote>Level 1<blockquote>Level 2</blockquote></blockquote>"
    expect(cleanHtmlEmail(html)).toBe("<p>My reply</p>")
  })

  it("removes gmail_attr attribution div", () => {
    const html = '<p>My reply</p><div class="gmail_attr">On Mon Apr 21 John wrote:</div>'
    expect(cleanHtmlEmail(html)).toBe("<p>My reply</p>")
  })

  // ── Signature cleanup ──────────────────────────────────────────────────────

  it('removes "Sent with X" inline element', () => {
    const html = "<p>My reply</p><span>Sent with Shortwave</span>"
    expect(cleanHtmlEmail(html)).toBe("<p>My reply</p>")
  })

  it("removes standalone app name elements (Shortwave)", () => {
    const html = '<p>My reply</p><span style="color:#4C8AFF">Shortwave</span>'
    expect(cleanHtmlEmail(html)).toBe("<p>My reply</p>")
  })

  // ── Trailing blank blocks ──────────────────────────────────────────────────

  it("removes trailing blank <p> elements (Outlook nbsp padding)", () => {
    const html = "<p>My reply</p><p>&nbsp;</p><p>  </p>"
    expect(cleanHtmlEmail(html)).toBe("<p>My reply</p>")
  })

  it("removes trailing blank <div> elements", () => {
    const html = "<p>My reply</p><div>&nbsp;</div>"
    expect(cleanHtmlEmail(html)).toBe("<p>My reply</p>")
  })

  // ── Text-pattern fallback ──────────────────────────────────────────────────

  it('truncates at "On Mon … wrote:" text pattern (Apple Mail / Outlook fallback)', () => {
    const html =
      "<p>My reply</p><p>On Mon Apr 21, 2025 at 10:00 AM John Smith wrote:</p><p>Old message</p>"
    const result = cleanHtmlEmail(html)
    expect(result).toContain("My reply")
    expect(result).not.toContain("Old message")
    expect(result).not.toContain("wrote:")
  })

  it("truncates at bold From:/Date: header (Apple Mail / iOS Mail, no border-top div)", () => {
    // Apple Mail sometimes omits the border-top wrapper; boldFrom/Date text pattern catches it.
    const html =
      "<p>My reply</p>" +
      "<p><b>From: </b>John Smith &lt;john@example.com&gt;<br>" +
      "<b>Date: </b>Mon, Apr 21, 2025<br>" +
      "<b>Subject: </b>Re: Test</p>" +
      "<p>Quoted body</p>"
    const result = cleanHtmlEmail(html)
    expect(result).toContain("My reply")
    expect(result).not.toContain("Quoted body")
  })

  it("truncates at bold From:/Sent: header (Outlook desktop, no border-top div)", () => {
    const html =
      "<p>My reply</p>" +
      "<p><b>From: </b>John Smith<br><b>Sent: </b>Monday, April 21, 2025<br></p>" +
      "<p>Quoted body</p>"
    const result = cleanHtmlEmail(html)
    expect(result).toContain("My reply")
    expect(result).not.toContain("Quoted body")
  })

  it("truncates at -----Original Message----- separator", () => {
    const html =
      "<p>My reply</p><p>-----Original Message-----</p><p>From: John</p><p>Old body</p>"
    const result = cleanHtmlEmail(html)
    expect(result).toContain("My reply")
    expect(result).not.toContain("Original Message")
    expect(result).not.toContain("Old body")
  })

  it("truncates at -----Forwarded Message----- separator", () => {
    const html =
      "<p>My reply</p><p>-----Forwarded Message-----</p><p>Old body</p>"
    const result = cleanHtmlEmail(html)
    expect(result).toContain("My reply")
    expect(result).not.toContain("Forwarded Message")
  })

  it("truncates at Chinese 发件人 pattern", () => {
    const html = "<p>My reply</p><p>发件人：John Smith</p><p>Old content</p>"
    const result = cleanHtmlEmail(html)
    expect(result).toContain("My reply")
    expect(result).not.toContain("Old content")
  })

  it("truncates at Chinese 写道 attribution pattern", () => {
    const html =
      "<p>My reply</p><p>2025年9月5日 01:14，Kevin Mahany 写道：</p><p>Original message</p>"
    const result = cleanHtmlEmail(html)
    expect(result).toContain("My reply")
    expect(result).not.toContain("Original message")
  })

  // ── Outlook border-top separator div ──────────────────────────────────────

  it("removes Outlook border-top separator div and everything after", () => {
    const html =
      '<p>My reply</p>' +
      '<div style="border:none;border-top:solid #B5C4DF 1.0pt;padding:3.0pt 0in 0in 0in">' +
      '<p><b>From: </b>John Smith</p></div>'
    const result = cleanHtmlEmail(html)
    expect(result).toContain("My reply")
    expect(result).not.toContain("border-top")
    expect(result).not.toContain("From:")
  })

  it("does NOT strip border-top div at position 0 (whole-email edge case)", () => {
    const html =
      '<div style="border:none;border-top:solid #B5C4DF 1.0pt;padding:3.0pt 0in 0in 0in">' +
      '<p>Content</p></div>'
    expect(cleanHtmlEmail(html)).toContain("Content")
  })

  // ── Earliest-match logic (regression for the "nested attribution shadows earlier match" bug) ──

  it("takes the EARLIEST attribution pattern when multiple patterns are present", () => {
    // "On Mon..." appears first; Chinese 写道: appears later (nested in quoted content).
    // Should truncate at the earlier "On Mon..." marker, not the later one.
    const html =
      "<p>My reply</p>" +
      "<p>On Mon Apr 21, 2025 at 10:00 AM John wrote:</p>" +
      "<p>2025年9月5日 Kevin 写道：（deeper nesting）</p>" +
      "<p>Deep nested original</p>"
    const result = cleanHtmlEmail(html)
    expect(result).toContain("My reply")
    expect(result).not.toContain("Deep nested")
    expect(result).not.toContain("写道")
  })
})

// ─── Real Gmail fixtures ───────────────────────────────────────────────────────
// Raw HTML fetched from Gmail API. Refresh a fixture:
//   tsx server/lib/test-cleaner.ts <id> --raw > server/lib/__tests__/fixtures/<id>.html

describe("cleanHtmlEmail — real Gmail fixtures", () => {
  it("19491ac0c7f23645: strips shortwave-signature div", () => {
    // Shortwave reply — shortwave-signature div immediately precedes quoted history.
    const raw = fixture("19491ac0c7f23645.html")
    const result = cleanHtmlEmail(raw)

    expect(result.length).toBeGreaterThan(100)
    expect(result).not.toMatch(/class="[^"]*shortwave-signature/)
    // Removes more than half the raw body
    expect(result.length).toBeLessThan(raw.length * 0.6)
  })

  it("19b4749784c16bb2: strips gmail_quote div", () => {
    // Gmail web reply — quoted history is wrapped in a gmail_quote div.
    const raw = fixture("19b4749784c16bb2.html")
    const result = cleanHtmlEmail(raw)

    expect(result.length).toBeGreaterThan(100)
    expect(result).not.toMatch(/class="[^"]*gmail_quote/)
    // gmail_quote carries ~99% of the raw body in this thread
    expect(result.length).toBeLessThan(raw.length * 0.02)
  })

  it("19b24990f8ff2ca5: strips Outlook border-top reply separator", () => {
    // Outlook desktop reply — border-top div wraps From/Date header block.
    const raw = fixture("19b24990f8ff2ca5.html")
    const result = cleanHtmlEmail(raw)

    expect(result.length).toBeGreaterThan(500)
    expect(result).not.toMatch(/border:none;border-top:solid/)
    // Quoted history was ~95% of the body
    expect(result.length).toBeLessThan(raw.length * 0.05)
  })

  it("19bb9ce27bf761f5: strips unclosed blockquote (Apple Mail / iOS)", () => {
    // Apple Mail reply — blockquote is opened but never closed; cleaner cuts at it.
    const raw = fixture("19bb9ce27bf761f5.html")
    const result = cleanHtmlEmail(raw)

    expect(result.length).toBeGreaterThan(100)
    // Removes the vast majority of the accumulated thread HTML
    expect(result.length).toBeLessThan(raw.length * 0.02)
  })

  it("19cbb4210e7ef740: preserves standalone email with no reply content", () => {
    // Single email with signature image — nothing to strip.
    const raw = fixture("19cbb4210e7ef740.html")
    const result = cleanHtmlEmail(raw)

    // Blank-block cleanup may remove some trailing whitespace, but body is intact
    expect(result.length).toBeGreaterThan(raw.length * 0.8)
    expect(result).not.toMatch(/border:none;border-top:solid/)
  })
})
