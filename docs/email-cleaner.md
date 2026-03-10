# Email Body Cleaning

Quoted reply history, forwarding headers, and app signatures are stripped from email bodies **server-side** in `parseMessage()` before the result is stored in the SQLite cache. This means the API always returns clean content — no re-processing per render.

## Files

| File | Role |
|------|------|
| `server/lib/email-cleaner.ts` | `cleanPlainText()` and `cleanHtmlEmail()` |
| `server/lib/gmail.ts` → `parseMessage()` | Calls the cleaner on every raw Gmail body |
| `server/lib/test-cleaner.ts` | Standalone debug script (see Testing below) |

## Plain Text Cleaning (`cleanPlainText`)

Scans lines and truncates at the first sign of quoted content:

| Pattern | Example |
|---------|---------|
| `>` quoted lines | `> On Mon...` |
| `On [date] ... wrote:` (up to 3 lines) | Gmail, Shortwave attribution |
| `发件人:` / Chinese Outlook block | `发件人：Grant ...发送时间：...` |
| Outlook `From: ... Sent:` block | Detected within 5 lines |
| `-----Original Message-----` | Outlook separator |
| `Caution: EXTERNAL` | Injected disclaimers |
| `Sent with/via [App]` | Removed (doesn't truncate) |
| Standalone app names | `Shortwave`, `Superhuman`, etc. (removed) |

## HTML Cleaning (`cleanHtmlEmail`)

Two-phase approach:

### Phase 1 — Structural truncation (fast path)

Exact class/id matches for known email clients. Slices the HTML string at the first matching element.

| Pattern | Client |
|---------|--------|
| `<div class="shortwave-signature">` | Shortwave |
| `<div class="gmail_quote/extra">` | Gmail |
| `<div id="divRplyFwdMsg">` | Outlook Web |
| `<hr tabindex="-1">` | Outlook (separator left after divRplyFwdMsg) |

Then removes `<blockquote>` elements iteratively (handles nesting), handles unclosed blockquotes (Apple Mail), and removes `<div class="gmail_attr">` attribution divs.

### Phase 2 — Text-pattern fallback

For clients that don't use recognized structural wrappers (Apple Mail, iOS Mail, Outlook desktop, Chinese Outlook). Scans the remaining HTML string with tag-permissive regexes.

**Key design**: all patterns are checked and the **earliest match position** wins — not the first pattern in order. This prevents a nested attribution deeper in the thread (e.g. an `On...wrote:` inside a quoted reply) from shadowing the actual reply boundary header which appears earlier.

| Pattern name | Matches |
|---|---|
| `发件人` | Chinese Outlook `发件人：` (colon may be in sibling span) |
| `写道` | Chinese `2025年9月5日...写道：` |
| `On...wrote` | `On Mon Apr 21, 2025 at...wrote:` (Gmail, Shortwave) |
| `boldFrom/Date` | `<b>From:</b>...<b>Date:</b>` or `<b>Sent:</b>` (Outlook, Apple Mail, iOS) |
| `---separator---` | `-----Original Message-----` |

The tag-permissive unit `T = "(?:[^<]|<[^>]+>)"` matches either a non-`<` character or a complete HTML tag, allowing patterns to span text that's been split across `<span>` elements (common in Outlook Word HTML and Apple Mail).

`findBlockStart(html, pos)` walks backwards from the match position to find the nearest enclosing block element (`div`, `p`, `table`, `tr`, `td`, etc.) so the cut happens at a clean boundary rather than mid-element.

### Phase 3 — Signature cleanup

- `Sent with/via [App]` elements removed
- Standalone app name elements removed (`<span>Shortwave</span>` etc.)
- Trailing blank `<p>/<div>` elements removed (Outlook `&nbsp;` padding)

## Testing

Run the vitest test suite — covers every pattern with both synthetic inline HTML and real Gmail fixture files:

```bash
cd packages/inbox
npm run test:run -- server/lib/__tests__/email-cleaner.test.ts
```

Fixture files are in `server/lib/__tests__/fixtures/`. Each fixture is the raw HTML body of a real Gmail message that exercises a specific structural or text pattern:

| Fixture | Pattern exercised |
|---------|------------------|
| `19491ac0c7f23645.html` | `shortwave-signature` div |
| `19b4749784c16bb2.html` | `gmail_quote` div |
| `19b24990f8ff2ca5.html` | Outlook `border:none;border-top:solid` separator div |
| `19bb9ce27bf761f5.html` | Unclosed `<blockquote>` (Apple Mail / iOS) |
| `19cbb4210e7ef740.html` | Baseline — no reply content, preserves body |

To add a new fixture when a new pattern is discovered:

1. Get the message ID from the thread URL (last path segment) or the SQLite cache:
   ```bash
   sqlite3 packages/inbox/data/inbox.db \
     "SELECT json_extract(data, '$.messages[1].id') FROM api_cache WHERE key = 'gmail:thread:<threadId>'"
   ```
2. Fetch the raw HTML via the Gmail API (format=full, decode the base64url body part) and save to `server/lib/__tests__/fixtures/<id>.html`
3. Add a test that asserts the pattern fires and the body is significantly reduced

## Cache invalidation

After deploying cleaner changes, existing cached threads won't be re-cleaned until they expire (5 min TTL). To force a refresh immediately:

```bash
# Clear all thread caches
sqlite3 packages/inbox/data/inbox.db "DELETE FROM api_cache WHERE key LIKE 'gmail:thread:%'"

# Clear a specific thread
sqlite3 packages/inbox/data/inbox.db "DELETE FROM api_cache WHERE key = 'gmail:thread:<id>'"
```
