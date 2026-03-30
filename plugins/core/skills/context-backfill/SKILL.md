---
name: context-backfill
description: "Build the raw source index in context/ from Gmail, Notion, Gorgias, Slack, and Claude session transcripts. Zero LLM cost — scripts produce markdown indexed by qmd."
triggers:
  - "run context backfill"
  - "backfill context"
  - "index emails"
  - "index notion pages"
  - "update knowledge base"
skills:
  - google-bigquery
  - google-workspace
  - context-management
created: 2025-06-01
last_run: null
last_run_status: null
run_count: 0
---

# Context Backfill

Builds the raw source index in `context/` from historical data across Gmail, Notion, Gorgias, Slack, and Claude session transcripts. All scripts produce markdown files that are indexed by qmd for semantic search — zero LLM inference cost. The curated `context/*.md` knowledge base is maintained separately by the context-management skill during live sessions.

## Sources

| Source | Directory | Files | Script | Discovery | Content |
|--------|-----------|-------|--------|-----------|---------|
| Gmail | `context/gmail/` | ~7,600 | `gmail/backfill.js` | BQ (initial) / Gmail API (incremental) | Gmail API |
| Notion | `context/notion/` | ~4,100 | `notion/backfill.js` | BQ | BQ |
| Gorgias | `context/gorgias/` | ~68,400 | `gorgias/backfill.js` | BQ | BQ (single JOIN) |
| Slack | `context/slack/` | 11 | `slack/backfill.js` | BQ | BQ |
| Transcripts | `context/transcripts/` | ~44 | `transcripts/backfill.js` | Local filesystem | Local filesystem |

## qmd Setup (one-time)

```bash
npm install -g @tobilu/qmd
brew install sqlite  # macOS system SQLite lacks extension support

qmd collection add "$(pwd)/context"
qmd collection rename context hammies-context
```

After any backfill run:

```bash
qmd update && qmd embed
```

---

## Gmail

**Script**: `gmail/backfill.js`

One file per email thread at `context/gmail/{thread-id}.md`.

### Discovery

- **Initial/full backfill** (`--full` or first run): BigQuery `messages_headers` (~115 GB scan). Applies sender/subject filters from `gmail/config.yaml` and "valuable contacts" rule (>1 thread).
- **Incremental** (default after first run): Gmail API `messages.list` with `after:` query — zero BQ cost. TypeScript-side sender/subject filtering applied after fetch.

### Rules

- **Skip inbox**: Only index archived emails (`-in:inbox` for Gmail API, `'INBOX' NOT IN UNNEST(labelIds)` for BQ). Inbox emails may be irrelevant, mislabeled, or pending deletion. Once archived, they're safe to index.
- **Truncation**: first 3 + last 5 messages for threads with >8 messages; 20 KB body cap per message.
- **Filters**: `gmail/config.yaml` defines sender excludes (~70 patterns), subject excludes, internal senders, and include overrides.

### Usage

```bash
node gmail/backfill.js           # incremental (Gmail API)
node gmail/backfill.js --full     # reprocess all (BQ)
node gmail/backfill.js --status   # report counts (BQ)
node gmail/backfill.js --contact user@example.com  # single contact (BQ)
node gmail/backfill.js --cleanup  # remove trashed threads
node gmail/backfill.js --prune    # remove threads matching exclude filters
```

### BQ cost

~115 GB per full/status run (no partition pruning on `messages_headers`). Incremental runs use Gmail API and cost nothing. Cap: `maximumBytesBilled = 150 GB`.

---

## Notion

**Script**: `notion/backfill.js`

One file per Notion page at `context/notion/{page-id}.md`.

### Architecture

- **Discovery**: BQ `hammies.notion.pages` — metadata only (page IDs, titles, content length). ~1 GB cap.
- **Content**: BQ batched content fetch in groups of 20 pages (predictable query sizes).
- **Private exclusion**: `private-page-ids.json` lists pages from 5 private databases (My Notes, Journal, People, Links, Projects). Built once with `--build-exclusions`, applied JavaScript-side.
- **Dedup**: Stitch appends duplicates; `ROW_NUMBER() OVER (PARTITION BY page_id ORDER BY _sdc_extracted_at DESC)`.

### Usage

```bash
node notion/backfill.js                    # process pending pages
node notion/backfill.js --status           # report counts
node notion/backfill.js --build-exclusions # one-time: build private ID list
node notion/backfill.js --page-id <id>    # single page
```

### Incremental

Re-run the script — it skips pages where `context/notion/{id}.md` already exists. No date-based incremental; just file-existence check.

---

## Gorgias

**Script**: `gorgias/backfill.js`

One file per support ticket at `context/gorgias/{ticket-id}.md`.

### Architecture

Single combined BQ JOIN: `tickets` (~30 MB) + `messages` (~1.8 GB) in one pass = **~1.86 GB total**. **Never batch-query the messages table** — it's clustered on `_sdc_batched_at` (not `ticket_id`), so each query scans the full 1.8 GB regardless of batch size.

- **Channels excluded**: `phone` (no transcript), `api` (system), `tiktok-shop`
- **Dedup**: both tables have Stitch duplicates; deduplicated by `_sdc_extracted_at DESC`
- **Content**: uses `stripped_text` (signature-stripped) with fallback to `body_text`
- **Truncation**: first 3 + last 5 messages for tickets with >8 messages; 20 KB body cap

### Usage

```bash
node gorgias/backfill.js            # process pending tickets
node gorgias/backfill.js --status   # report counts
node gorgias/backfill.js --dry-run
node gorgias/backfill.js --ticket-id 12345
node gorgias/backfill.js --since 2025-01-01
node gorgias/backfill.js --full     # reprocess all
```

### Incremental

Re-run the script — skips tickets where `context/gorgias/{id}.md` already exists. Use `--since` to limit the BQ discovery query to recent tickets (though messages table still scans fully). BQ cap: 10 GB.

---

## Slack

**Script**: `slack/backfill.js`

One file per channel at `context/slack/{channel-id}.md`.

### Architecture

Single combined BQ query joining messages + threads + channels + users (<2 MB total scan). Groups by channel in JavaScript; thread replies nested under parent messages. `<@USERID>` mentions resolved to real names.

Filtered out: join/leave/archive system messages, bot messages, empty text. No manifest — files are small enough to always regenerate.

### Usage

```bash
node slack/backfill.js              # process pending channels
node slack/backfill.js --status
node slack/backfill.js --channel-id C03QRB2MAQJ
node slack/backfill.js --full       # overwrite all
```

### Incremental

Use the Slack skill for real-time message data. The backfill script regenerates full channel history from BQ each run.

---

## Transcripts

**Script**: `transcripts/backfill.js`

One file per Claude Code session at `context/transcripts/{session-id}.md`.

### Architecture

Reads `.jsonl` session files from `~/.claude/projects/-Users-grant-Github-hammies-hammies-agent/`. Streams line-by-line (some files are 200+ MB). Extracts only user text and assistant text blocks — skips thinking, tool_use, tool_result, system, progress records.

- **Truncation**: first 20 + last 30 turns for sessions exceeding 50 turns
- **User text cleaning**: strips system-injected XML tags (`<ide_opened_file>`, `<system-reminder>`, etc.)

### Usage

```bash
node transcripts/backfill.js            # process pending sessions
node transcripts/backfill.js --status
node transcripts/backfill.js --session-id <uuid>
node transcripts/backfill.js --full     # reprocess all
```

### Incremental

Re-run the script — skips sessions where `context/transcripts/{id}.md` already exists.

---

## BQ Cost Summary

| Source | Per-run scan | Notes |
|--------|-------------|-------|
| Gmail (full) | ~115 GB | No partition pruning; avoid repeated runs |
| Gmail (incremental) | 0 | Gmail API — free |
| Notion | <1 GB | Small table |
| Gorgias | ~1.86 GB | Single JOIN; never batch messages table |
| Slack | <2 MB | Tiny tables |
| Transcripts | 0 | Local filesystem |

**Daily quota**: 500 GB recommended. At $6.25/TB on-demand: ~$94/month at full cap.

**Critical rule**: Never batch-query content/body tables repeatedly. Use a single combined query (Gorgias pattern) or switch to the source API for incremental updates (Gmail pattern).

---

## Files

```
workflows/context-backfill/
├── PLAN.md
├── lib/
│   └── utils.js               # Shared: runBQ (direct REST API), fileExists, manifest I/O, cleanBody, truncateArray
├── gmail/
│   ├── backfill.js            # Gmail API (incremental) / BigQuery (full)
│   ├── config.yaml            # Sender/subject include/exclude patterns
│   └── manifest.json
├── notion/
│   ├── backfill.js            # BigQuery discovery + content
│   ├── manifest.json
│   └── private-page-ids.json  # Generated by --build-exclusions
├── gorgias/
│   └── backfill.js            # Single BQ JOIN query
├── slack/
│   └── backfill.js            # BQ (<2 MB)
└── transcripts/
    ├── backfill.js            # Local filesystem
    └── manifest.json

context/
├── *.md                   # Curated entity pages (~137)
├── gmail/                 # Raw email threads (~7,600)
├── notion/                # Raw Notion pages (~4,100)
├── gorgias/               # Raw Gorgias tickets (~68,400)
├── slack/                 # Raw Slack channels (11)
└── transcripts/           # Claude session transcripts (~44)
```
