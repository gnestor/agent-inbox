# Gmail Plugin

## Purpose

The built-in `gmail` plugin (`plugins/gmail/`) — a full `Plugin` shape with `query`/`getItem`/`mutate`/`itemToContext`/`filterOptions`/`routes`, plus a custom React detail component (`EmailThread`) and a list view (`EmailListView`) embedded as plugin components. Wraps the Gmail API for thread search, single-thread fetch, label/star/archive/trash mutations, draft + send composition with cached signature, and an attachment proxy. The plugin's `auth: { integrationId: "google", scope: "user" }` declares per-user OAuth; tokens are obtained via `PluginContext.getCredential("google")` (with refresh handled in `plugin-context.ts`). `itemToContext` shapes raw threads into the markdown stub format the context-system pipeline consumes.

## Context

### Why Gmail is a built-in, not a [workspace](../workspace/spec.md) plugin
Gmail is the canonical inbox source — every workspace uses it, and the [integration](../integrations/spec.md) is non-trivial (OAuth refresh, label fetch, sanitiser, attachment proxy, signature cache). Shipping it as a built-in means new workspaces work immediately; an `agent`-workspace override exists for itemToContext customisation but doesn't reimplement the API layer.

### Why thread fetches go through a 5-minute `api_cache` TTL
A single thread can be 200k+ characters (accumulated reply history). Round-tripping the Gmail API on every render of the SessionView's email-attachment context would be slow and costly. The 5-minute TTL is short enough that label/read-state changes propagate quickly but long enough that opening the same thread twice in a session is free — see also the email-sanitizer spec, which writes sanitised HTML into the same cache key (`gmail:thread:<id>`).

### Why user labels are cached per access token, not per user email
Two windows for the same Google account share an access token (it's the OAuth artifact). Caching the user-label map by access token means simultaneous tabs share the cache without an extra "look up the user from the token" step. TTL is 5 minutes — labels rarely change at the per-second timescale, but a 1-hour TTL would make new-label visibility annoyingly slow.

### Why signatures are cached for 1 hour per user email
A signature changes when the user updates their Gmail settings — typically never within a session. Signatures are appended to every send and draft; without caching, every compose would round-trip a signature fetch. The cache key is `userEmail` (not access token) because signatures are user-specific and stable across token refreshes.

### Why attachments are proxied, not fetched directly from Gmail in the browser
Browser-side fetches would require exposing the OAuth token to the SPA. The proxy (`GET /api/gmail/messages/:id/attachments/:attachmentId?filename=`) keeps the token server-side, sniffs the MIME type from filename or magic bytes, and serves with `Cache-Control: public, max-age=31536000, immutable` — Gmail attachments are content-addressed by ID, so they never change.

### Why MIME sniffing has both a filename map and a magic-byte sniff
The Gmail attachment endpoint returns raw bytes without a content-type. If the caller provides `?filename=`, the extension drives MIME selection (more accurate for spoofable formats like `.csv`). If not, magic-byte sniffing handles common image formats (PNG, JPEG, GIF, WebP) — the rest fall back to `application/octet-stream`, which browsers treat as "download".

### Why `itemToContext` filters automated senders inline
The function returns `null` for messages from `noreply@`, `no-reply@`, `notifications@`, `automated@`, `donotreply@` locals. These would pollute the context index with marketing/transactional noise that has zero curation value. Doing the filter at stub-generation time means the curation pipeline never sees them; doing it later would still write a stub to disk first.

### Why `filterOptions.labels` only returns user labels
Gmail has a fixed set of system labels (`INBOX`, `UNREAD`, `STARRED`, `IMPORTANT`, etc.) which are surfaced as derived boolean fields (`isImportant`, `isStarred`). User labels are the long tail — exposing them through the filter UI lets users narrow by their own categorisation without conflating with system flags.

### Why label badges are capped at 3
Labels are text — three is the empirical cap before list rows become unreadable. The plugin's `addDerivedFields` slices at `MAX_LABEL_BADGES = 3`; users with more than three labels per thread see a truncated set. Filtering via the labels filter is the way to find threads with specific other labels.

### What is NOT in scope
- The OAuth flow that produces the Google credential → `auth-and-sessions` and `credentials-vault`.
- The HTML email sanitiser called inside `gmail.parseMessage` → `email-sanitizer`.
- The SessionView email-attachment widget that consumes parsed threads → `session-views-controller`.
- The plugin loader, registry, route auto-mounting → `plugin-system`.
- The context-system pipeline that consumes `itemToContext` output → `context-system`.

## Requirements

### Plugin manifest

#### Scenario: Manifest declares per-user Google OAuth and a custom detail component
- **WHEN** the loader registers the plugin
- **THEN** the manifest is `{ id: "gmail", name: "Emails", icon: "Mail", emoji: "✉️", components: { detail: "EmailThread" }, auth: { integrationId: "google", scope: "user" } }`.
- **AND** the plugin's tab uses the custom `EmailThread` component for the detail panel; the list uses `EmailListView`.

#### Scenario: Field schema declares list roles and filterable system flags
- **WHEN** the SPA fetches `GET /api/plugins`
- **THEN** it sees `from` (subtitle), `subject` (title), `date` (timestamp), boolean badges `isUnread`/`isImportant`/`isStarred`, hidden `body` (html) and `flags`, multiselect `labels` (badge variant outline).
- **AND** `flags` is filterable with options `["important", "starred", "unread", "snoozed"]`.

### Query and detail

#### Scenario: `query` builds a Gmail search string from filter fields
- **WHEN** the route invokes `query(filters, cursor, ctx)`
- **THEN** the search starts with `filters.q` if present (else `in:inbox`); appends `is:<flag>` for each comma-separated flag in `filters.flags`; appends `label:<label>` for each in `filters.labels`.
- **AND** the function fetches threads (page size 20) and the user-label map in parallel, calls `addDerivedFields` to attach `isImportant`/`isStarred`/`labels`, returns `{ items, nextCursor }`.

#### Scenario: `getItem` returns the full thread including sanitised HTML
- **WHEN** the route invokes `getItem(threadId, ctx)`
- **THEN** the function calls `gmail.getThread(accessToken, threadId)` which is the integration boundary that runs `parseMessage` (the sanitiser entry) on every message body.

### Mutations

#### Scenario: `mutate` dispatches over a fixed action set
- **WHEN** the route invokes `mutate(id, action, payload, ctx)` with `action ∈ { archive, trash, star, unstar, mark-important, mark-not-important, modify-labels, send, save-draft }`
- **THEN** each case calls the corresponding `gmail.modifyThreadLabels`/`trashThread`/`sendMessage`/`createDraft` helper.
- **AND** unknown actions throw `Error("Unknown Gmail action: ${action}")` — the route translates this into a 400 via Hono's error handling.

#### Scenario: `archive` removes the `INBOX` label without trashing
- **WHEN** the action is `archive`
- **THEN** `modifyThreadLabels(accessToken, id, [], ["INBOX"])` is called — Gmail's archive semantics, not delete.

#### Scenario: `send` and `save-draft` append a cached signature
- **WHEN** the action is `send` or `save-draft`
- **THEN** `composeWithSignature` resolves the signature via the 1-hour `signatureCache` keyed by `ctx.userEmail`, then delegates to `gmail.sendMessage` / `gmail.createDraft`.

### Caching

#### Scenario: User-label map cache is keyed by access token with 5-minute TTL
- **WHEN** any handler calls `getUserLabelMapCached(accessToken)`
- **THEN** the function returns the cached `Map<labelId, labelName>` if `Date.now() - ts < 5 * 60 * 1000`, else refetches via `gmail.getLabels` and stores the user-only entries (`l.type === "user"`).

#### Scenario: Signature cache is keyed by user email with 1-hour TTL
- **WHEN** any handler calls `getSignatureCached(accessToken, userEmail)`
- **THEN** the function returns the cached signature if `Date.now() - ts < 60 * 60 * 1000`, else refetches.

### Routes (plugin-mounted)

#### Scenario: Attachment proxy serves with long immutable cache
- **WHEN** `GET /api/gmail/messages/:id/attachments/:attachmentId` is called
- **THEN** the route resolves the access token, fetches via `gmail.getAttachment`, sets `Content-Type` from `mimeFromFilename(filename)` if `?filename=` is provided else `sniffMimeType(buf)`, sets `Cache-Control: public, max-age=31536000, immutable`, and includes `Content-Disposition: inline; filename="..."` when the filename is present.

#### Scenario: `GET /api/gmail/signature` returns the cached signature
- **WHEN** the SPA's compose UI mounts
- **THEN** the route returns `{ signature }` from `getSignatureCached`.

#### Scenario: `GET /api/gmail/messages` is a `?q=`-parameterised list
- **WHEN** legacy callers hit `/messages` with `?q=` and `?pageToken=`
- **THEN** the route delegates to `gmailPlugin.query!({ q })` and returns `{ messages, nextPageToken }` — preserving the pre-plugin URL shape.

### Context-system integration

#### Scenario: `itemToContext` skips automated senders and produces frontmatter+body markdown
- **WHEN** the curation pipeline calls `itemToContext(item)`
- **THEN** the function returns `null` if `from` matches one of `noreply@`/`no-reply@`/`notifications@`/`automated@`/`donotreply@`, OR if both `subject` and `body` are empty.
- **AND** otherwise it returns a markdown stub with frontmatter (`type: email-thread`, `thread-id`, `subject`, `date`) followed by the subject as `# heading`, the `From:` line, optional `Date:` line, and the body.
- **AND** quotes inside the subject are escaped (`"` → `\"`).

### Filter-options surface

#### Scenario: `filterOptions.labels` returns sorted user-label names
- **WHEN** the SPA fetches `GET /api/gmail/fields/labels/options`
- **THEN** the plugin returns Gmail's user-typed labels sorted alphabetically.
- **AND** system labels (`INBOX`, `UNREAD`, `STARRED`, `IMPORTANT`, etc.) are excluded — those are surfaced through the boolean derived fields.

## Technical Notes

| Concern | Location |
|---|---|
| Plugin manifest, query, getItem, mutate, filterOptions, routes, itemToContext | [plugins/gmail/plugin.ts](../../../plugins/gmail/plugin.ts) |
| Gmail API client (search, getThread, modifyLabels, trash, send, draft, attachments, labels, signature) | `plugins/gmail/app/lib/gmail.ts` |
| HTML email sanitiser (called from `parseMessage` in gmail.ts) | `plugins/gmail/app/lib/email-sanitizer.ts` |
| HTML → Markdown converter for context-system stubs | [plugins/gmail/app/lib/email-to-markdown.ts](../../../plugins/gmail/app/lib/email-to-markdown.ts) |
| Frontend list component | [plugins/gmail/app/components/EmailListView.tsx](../../../plugins/gmail/app/components/EmailListView.tsx) |
| Frontend detail component (custom thread renderer) | [plugins/gmail/app/components/EmailThread.tsx](../../../plugins/gmail/app/components/EmailThread.tsx) |
| Frontend hooks (use-emails, use-email-thread, use-email-actions, use-email-draft) | [plugins/gmail/app/hooks/](../../../plugins/gmail/app/hooks/) |
| Live integration tests (excluded from `test:ci`, owned by `email-sanitizer`) | `plugins/gmail/app/__tests__/email-sanitizer-live.test.ts` |
| Gmail API client tests | [plugins/gmail/app/__tests__/gmail.test.ts](../../../plugins/gmail/app/__tests__/gmail.test.ts) |
| HTML → Markdown converter tests | [plugins/gmail/app/__tests__/email-to-markdown.test.ts](../../../plugins/gmail/app/__tests__/email-to-markdown.test.ts) |
| Frontend hook tests | [plugins/gmail/app/__tests__/use-emails.test.tsx](../../../plugins/gmail/app/__tests__/use-emails.test.tsx), [plugins/gmail/app/__tests__/use-email-thread.test.tsx](../../../plugins/gmail/app/__tests__/use-email-thread.test.tsx), [plugins/gmail/app/__tests__/use-email-actions.test.tsx](../../../plugins/gmail/app/__tests__/use-email-actions.test.tsx) |
| Shared test helper | [plugins/gmail/app/__tests__/fetch-thread.ts](../../../plugins/gmail/app/__tests__/fetch-thread.ts) |
| Frontend Gmail-specific API client wrappers | [plugins/gmail/app/api.ts](../../../plugins/gmail/app/api.ts) |
| Frontend Gmail wire types (`GmailMessage`, `GmailThread`, `GmailAttachment`) | [plugins/gmail/app/types.ts](../../../plugins/gmail/app/types.ts) |
| Server-side structural types for the Gmail API subset consumed | [plugins/gmail/app/lib/gmail-api-types.ts](../../../plugins/gmail/app/lib/gmail-api-types.ts) |

## History

- The Gmail plugin was originally a server route (`server/routes/gmail.ts`) plus a frontend hook; collapsed into a plugin once the `Plugin` interface gained enough surface (`routes`, `components`, `itemToContext`) to express it without a special case.
- The 5-minute thread cache was added after a profile of the SessionView's email-attachment widget showed every render hitting `users.threads.get` for the same thread; the same key (`gmail:thread:<id>`) is shared with the email-sanitizer's cached output.
- The signature 1-hour TTL replaced an unbounded cache after a regression where editing a Gmail signature didn't propagate within the same session day.
- The user-label cache used to be keyed by `userEmail`; switched to access token after a multi-account regression where user A's labels were served to user B because the email-to-token map was stale.
- `itemToContext`'s automated-sender list was empirically grown by adding patterns whenever a noreply variant slipped into the curated context — current set covers ~99% of marketing/transactional noise observed.
- `MAX_LABEL_BADGES = 3` was lowered from 5 after UX feedback that long label rows pushed the timestamp off-screen on narrow panels.
