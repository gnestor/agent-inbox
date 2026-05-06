# Email Sanitizer

## Purpose

Strip quoted reply history, forwarding headers, signatures, and client-injected disclaimers from inbound email bodies so the inbox displays only the new content of each message. Sanitization runs **server-side** during message parsing, so the API never returns raw client HTML to the frontend.

This is a defensive subsystem: every commercial email client formats quoted history differently, and any one of them will silently re-introduce a wall of duplicated thread history if its pattern stops being recognized. The spec exists to document *which patterns are load-bearing* and why, so future changes don't regress a client-specific path that has no obvious test coverage.

## Context

### Why server-side, not client-side
Sanitization is expensive (regex sweeps over up-to-200kB strings) and idempotent. Doing it once in `parseMessage()` means the WebSocket/REST layer never has to ship raw HTML, the frontend never has to handle adversarial markup, and React Query's client-side cache stores only cleaned content.

### Why not a real HTML parser
We tried. The patterns we need to detect — `On...wrote:` text fragmented across `<span>` boundaries, Outlook's bold-`From:` blocks, Chinese full-width colons inside sibling spans — are textual, not structural. A DOM walk solves the easy 30%; the regex fallback is what handles the long tail. The cost is fragility against new clients, mitigated by the fixture suite.

### Earliest-match rule
The most common past bug was a nested `On...wrote:` *inside* a quoted reply matching before the actual reply boundary, because the regex iteration found the inner one first. The fix — scan all patterns and take the one with the lowest match index — is the only reason multi-level threads render correctly.

## Requirements

### Sanitize plain-text bodies

`sanitizePlainText(text: string): string` MUST truncate or remove lines that mark the boundary between the reply and quoted history.

#### Scenario: Truncates at `>`-prefixed quote lines
- **WHEN** a line begins with `>` (after `trim()`)
- **THEN** the function returns everything before that line.

#### Scenario: Truncates at "On ... wrote:" attribution
- **WHEN** the next 1–3 lines, joined, match `^On\s.+\bwrote:`
- **THEN** the function returns everything before the first of those lines.
- **AND** this MUST work for both Gmail (`On Thu, Feb 19, 2026 at 4:25 PM`) and Shortwave (`On Mon Apr 21...`) formats.

#### Scenario: Truncates at Chinese "wrote:" attribution
- **WHEN** a line matches `\d{4}年\d+月\d+日.+写道[:：]`
- **THEN** the function returns everything before that line.

#### Scenario: Truncates at Outlook reply header block
- **WHEN** a line begins with `From:` AND any of the next 4 lines starts with `Sent:` or `Date:`
- **THEN** the function returns everything before the `From:` line.

#### Scenario: Truncates at Chinese Outlook header
- **WHEN** a line begins with `发件人:` or `发件人：` (full-width colon)
- **THEN** the function returns everything before that line.

#### Scenario: Truncates at Original/Forwarded message separator
- **WHEN** a line matches `-{5,}(Original|Forwarded) Message-{5,}`
- **THEN** the function returns everything before that line.

#### Scenario: Truncates at injected security disclaimer
- **WHEN** a line begins with `Caution: EXTERNAL`
- **THEN** the function returns everything before that line.

#### Scenario: Removes "Sent with/via X" footer without truncating
- **WHEN** a line matches `Sent (with|via) \S`
- **THEN** that line is removed but subsequent content is preserved.

#### Scenario: Removes standalone client-name footers
- **WHEN** a line equals one of `Shortwave|Superhuman|Spark|Hey|Fastmail|Newton|Airmail|Front|Missive` (case-insensitive)
- **THEN** that line is removed but subsequent content is preserved.

### Sanitize HTML bodies via structural matches first

`sanitizeHtmlEmail(html: string, opts?: SanitizeOptions): string` MUST first attempt to truncate at known per-client structural markers before falling back to text patterns.

#### Scenario: Truncates Shortwave at signature div
- **WHEN** the HTML contains `<div class="...shortwave-signature...">`
- **THEN** the function returns everything before the opening `<div>`.

#### Scenario: Truncates Gmail at quote/extra wrapper
- **WHEN** the HTML contains `<div class="...gmail_quote..."` or `gmail_extra`
- **THEN** the function returns everything before the opening `<div>`.

#### Scenario: Truncates Outlook Web at reply div
- **WHEN** the HTML contains `<div id="divRplyFwdMsg">` or a leftover `<hr tabindex="-1">`
- **THEN** the function returns everything before the enclosing block element.

#### Scenario: Truncates Outlook desktop / Apple Mail at border-top separator
- **WHEN** the HTML contains a `<div>` whose `style` matches `border:none;border-top:solid`
- **THEN** the function returns everything before that div.

#### Scenario: Truncates GoHighLevel / Lead Connector at reply-timestamp-box
- **WHEN** the HTML contains `<div class="...reply-timestamp-box...">`
- **THEN** the function returns everything before that div.

#### Scenario: Truncates Gmail embedded thread tables
- **WHEN** the HTML contains `<table class="...gmail-cf gmail-gJ...">`
- **THEN** the function returns everything before the enclosing block.

### Sanitize HTML bodies via text-pattern fallback

After structural cleanup, the function MUST scan the remaining HTML for textual attribution markers. **All patterns** are evaluated and the **earliest** match wins.

#### Scenario: Earliest match wins across patterns
- **WHEN** multiple attribution patterns match the HTML
- **THEN** the one with the lowest character index is selected, regardless of pattern order.
- **WHY** Prevents a nested `On...wrote:` inside a quoted reply from shadowing an earlier reply-boundary header (e.g. an Outlook bold-`From:` block or a Chinese `发件人:` header).

#### Scenario: Matches "On ... wrote:" with HTML tags interspersed
- **WHEN** the attribution text is split across `<span>` elements (Outlook Word HTML, Apple Mail)
- **THEN** the regex MUST treat any complete HTML tag as a passthrough character, using the unit `T = (?:[^<]|<[^>]+>)`.

#### Scenario: Matches bold From/Sent or From/Date blocks
- **WHEN** the HTML contains a `<b>` or `<strong>` element wrapping `From:` followed within ~400 chars by another bold `Sent:` or `Date:`
- **THEN** the function truncates at the enclosing block.

#### Scenario: Cuts at clean block boundary
- **WHEN** a text-pattern match is found at character position `pos`
- **THEN** the function MUST find the start of the nearest enclosing block element (`div|p|table|tr|td|blockquote|article|section|hr`) at or before `pos` and slice there — never mid-element.

### Remove blockquotes iteratively

#### Scenario: Removes innermost blockquotes first
- **WHEN** the HTML contains nested `<blockquote>` elements
- **THEN** the function MUST repeatedly remove only innermost blockquotes (those with no nested `<blockquote>` inside) until none remain.
- **WHY** A naive single-pass regex pairs an outer opening tag with an inner closing tag and leaves a dangling `</blockquote>`.

#### Scenario: Truncates at unclosed blockquote
- **WHEN** the HTML contains an unclosed `<blockquote>` (Apple Mail / iOS Mail emit these)
- **THEN** the function returns everything before the enclosing block of that opening tag.

### Strip background colors

#### Scenario: Removes inline background-color and bgcolor
- **WHEN** the HTML contains `style="...background-color: X;..."` or `bgcolor="X"`
- **THEN** the function MUST remove those declarations.
- **WHY** HTML emails (e.g. calendar invites) hard-code colors that clash with the inbox's own theme in both light and dark modes.

### Strip client-app signature lines

#### Scenario: Removes "Sent with/via X" elements and free text
- **WHEN** the HTML contains an element wrapping `Sent (with|via) X` OR free `Sent (with|via) X` text
- **THEN** that content is removed.

#### Scenario: Removes standalone client-name elements
- **WHEN** the HTML contains an element wrapping only a known client name (`Shortwave`, `Superhuman`, `Spark`, `Hey`, `Fastmail`, `Newton`, `Airmail`, `Front`, `Missive`)
- **THEN** that element is removed.

### Strip trailing whitespace blocks

#### Scenario: Removes trailing blank `<p>`/`<div>` elements
- **WHEN** a `<p>` or `<div>` at the end of the body contains only whitespace, `&nbsp;`, or inline tags (excluding `<img>`)
- **THEN** that element is removed, repeating until stable.
- **WHY** Outlook and Word HTML emit deep `&nbsp;` padding that produces visible empty space in the rendered body.

### Honor `keepSignature` option

#### Scenario: Preserves Gmail signature on the last message of a thread
- **WHEN** `opts.keepSignature` is `true`
- **THEN** the function MUST NOT remove `<div class="gmail_signature">` or `<span class="gmail_signature_prefix">`.
- **WHY** The signature is the user's own and should be visible on the most-recent message; on quoted history it's noise.

### Caller integrates sanitizer with markdown conversion

The Gmail message parser MUST call the sanitizer **before** converting HTML to markdown.

#### Scenario: HTML body flow
- **WHEN** `parseMessage()` receives a Gmail API message with HTML body
- **THEN** the body MUST pass through `sanitizeHtmlEmail` → `htmlToMarkdown`, in that order, before being returned in the API response.

#### Scenario: Plain body flow
- **WHEN** `parseMessage()` receives a plain-text body
- **THEN** the body MUST pass through `sanitizePlainText` before being returned.

#### Scenario: Last-message signature preservation
- **WHEN** `parseMessage()` is called for the last message of a thread
- **THEN** it MUST be invoked with `{ keepSignature: true }`.

## Technical Notes

| Requirement | Implementation |
|---|---|
| Sanitize plain-text bodies | [`plugins/gmail/app/lib/email-sanitizer.ts:16-69`](../../../plugins/gmail/app/lib/email-sanitizer.ts#L16-L69) — `sanitizePlainText` |
| Sanitize HTML bodies via structural matches first | [`plugins/gmail/app/lib/email-sanitizer.ts:121-162`](../../../plugins/gmail/app/lib/email-sanitizer.ts#L121-L162) |
| Sanitize HTML bodies via text-pattern fallback (patterns) | [`plugins/gmail/app/lib/email-sanitizer.ts:85-104`](../../../plugins/gmail/app/lib/email-sanitizer.ts#L85-L104) — `HTML_TEXT_QUOTE_PATTERNS` |
| Sanitize HTML bodies via text-pattern fallback (earliest-match scan) | [`plugins/gmail/app/lib/email-sanitizer.ts:186-203`](../../../plugins/gmail/app/lib/email-sanitizer.ts#L186-L203) |
| Sanitize HTML bodies via text-pattern fallback (block boundary) | [`plugins/gmail/app/lib/email-sanitizer.ts:110-114`](../../../plugins/gmail/app/lib/email-sanitizer.ts#L110-L114) — `findBlockStart` |
| Remove blockquotes iteratively | [`plugins/gmail/app/lib/email-sanitizer.ts:169-180`](../../../plugins/gmail/app/lib/email-sanitizer.ts#L169-L180) |
| Strip background colors | [`plugins/gmail/app/lib/email-sanitizer.ts:209-210`](../../../plugins/gmail/app/lib/email-sanitizer.ts#L209-L210) |
| Strip client-app signature lines | [`plugins/gmail/app/lib/email-sanitizer.ts:214-221`](../../../plugins/gmail/app/lib/email-sanitizer.ts#L214-L221) |
| Strip trailing whitespace blocks | [`plugins/gmail/app/lib/email-sanitizer.ts:223-238`](../../../plugins/gmail/app/lib/email-sanitizer.ts#L223-L238) |
| Honor `keepSignature` option | [`plugins/gmail/app/lib/email-sanitizer.ts:151-156`](../../../plugins/gmail/app/lib/email-sanitizer.ts#L151-L156); option type at [`:116-119`](../../../plugins/gmail/app/lib/email-sanitizer.ts#L116-L119) |
| Caller integrates sanitizer with markdown conversion | [`plugins/gmail/app/lib/gmail.ts:165-167`](../../../plugins/gmail/app/lib/gmail.ts#L165-L167); thread parser at [`:295-310`](../../../plugins/gmail/app/lib/gmail.ts#L295-L310) |

### Tests

- Unit suite: [`plugins/gmail/app/__tests__/email-sanitizer.test.ts`](../../../plugins/gmail/app/__tests__/email-sanitizer.test.ts) — synthetic HTML + Gmail fixtures.
- Live suite (Gmail API, excluded from `test:ci`): [`plugins/gmail/app/__tests__/email-sanitizer-live.test.ts`](../../../plugins/gmail/app/__tests__/email-sanitizer-live.test.ts).

Run: `cd packages/inbox && npm run test:run -- plugins/gmail/app/__tests__/email-sanitizer.test.ts`

Debug a real thread: `THREAD_ID=<id> npx vitest run plugins/gmail/app/__tests__/email-sanitizer-live.test.ts`. Save fixture: prepend `SAVE_FIXTURE=1`.

### Fixtures

Each fixture exercises one structural or text pattern; adding a new client means adding both a fixture and a test that asserts the pattern fires.

| Fixture | Pattern |
|---------|---------|
| `19491ac0c7f23645.html` | `shortwave-signature` div |
| `19b4749784c16bb2.html` | `gmail_quote` div |
| `19b24990f8ff2ca5.html` | Outlook `border-top:solid` separator |
| `19bb9ce27bf761f5.html` | Unclosed `<blockquote>` (Apple Mail / iOS) |
| `19beace60dce19c1.html` | `reply-timestamp-box` (GoHighLevel / Lead Connector) |
| `19cbb4210e7ef740.html` | Baseline — no reply content, body preserved |
| `19cdd7499dd94a09.html`, `19cf977c2a39cfec.html`, `19d0f3a12b81e7e6.html` | Additional regression fixtures |

To add a fixture, fetch the raw HTML body part via the Gmail API (format=full, base64url decode) and write it to `plugins/gmail/app/__tests__/fixtures/<messageId>.html`.

### Cache invalidation

The previous SQLite `api_cache` table was dropped (migration ``004_drop_api_cache.sql``). Caching is now React Query client-side only — sanitizer changes take effect on the next refetch (no manual invalidation needed).

## History

| Date | Commit | Change |
|------|--------|--------|
| 2026-05-05 | _pending_ | Initial OpenSpec port from `docs/email-cleaner.md`. Updates stale `server/lib/` paths to current `plugins/gmail/app/lib/` location. Removes obsolete SQLite `api_cache` references — caching is now React Query client-side only. No behavior change. |
