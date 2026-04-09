---
name: context-manager
description: Query and update the context/ knowledge base. Handles semantic search via qmd, entity identification, and structured context page writes. Use whenever gathering context for any task, creating/updating context pages, or documenting session findings.
---

# Context Management

Consolidates all operations on `context/` — reading existing knowledge and writing structured context pages.

The knowledge base has two layers in a single directory tree:
- `context/*.md` — curated summaries (entity pages, decisions, timelines, cross-links)
- `context/{source}/{id}.md` — raw source files indexed by the context-backfill workflow

Sources: `gmail/`, `notion/`, `gorgias/`, `slack/`, `sessions/`

Both layers are indexed in the `hammies-context` qmd collection. Curated pages rank higher for entity-identity queries; raw sources rank higher for specific factual lookups. **Raw source files are written exclusively by the context-backfill workflow — do not write to source subdirectories from within a session.**

---

## Data Source Guide

| Task | Use |
|------|-----|
| Find curated context about an entity | **qmd** — `qmd query` against `hammies-context` |
| Factual lookup (specific date, amount, decision) | **qmd** — `qmd query "<specific question>"`, then read matched files |
| Explore a topic or person broadly | **qmd** — `qmd query "<keywords>"`, follow cross-links in matched pages |
| Find raw source by ID | Direct file: `context/gmail/{thread-id}.md`, `context/notion/{page-id}.md`, etc. |
| Search Gmail threads by sender | **BigQuery** or **Gmail API** via google-workspace skill |
| Search Notion pages | **Notion API** via notion skill, or **BigQuery** for batch discovery |
| Read full email body | **Gmail API** — `google-workspace get-thread <id>` |
| Read full Notion page | **Notion API** — `notion notion-to-md <page-id>` |
| Semantic search across all indexed knowledge | **qmd** — `qmd query "<question>"` hybrid search (best quality) |

---

## Query (Read Context)

### For specific questions (factual lookups)

Generate questions or descriptions of the required context, then query:

```bash
qmd query "<specific question or description>" -c hammies-context
```

Read the top-ranked files. If the answer references other entities, follow `[text](link.md)` cross-links in `## Related` one level deep.

### For general research / exploration

Extract keywords and entities from the user's prompt. Query each:

```bash
qmd query "<entity name> <keywords>" -c hammies-context
```

If qmd returns low-confidence matches, also try exact match:

```bash
grep -ri "<domain or email>" context/*.md -l
```

### Fetching from original data sources

When qmd results reference raw source files but you need fresher or more complete data, fetch from the original source:

```bash
# Gmail — full thread content
node .claude/skills/google-workspace/scripts/client.js get-thread --id <threadId>

# Notion — full page content
node .claude/skills/notion/scripts/client.js notion-to-md --page-id <pageId>

# BigQuery — batch queries for Gmail/Notion/Gorgias/Slack
node .claude/skills/google-bigquery/scripts/client.js query "<sql>"
```

If the content is already indexed locally, prefer the local file (`context/{source}/{id}.md`) — it's immediately available with clean formatting.

---

## Update (Write Context)

Any context that was useful in a session should be documented in the curated context files (`context/*.md`).

### Key Principles

- **Context files are the hub**: They link to raw sources, Notion pages, email threads, and other resources — the agent discovers context by searching `context/` and following links
- **Capture anything useful**: The test for whether something gets a context page is: "Will this help the agent answer questions or perform tasks for Hammies in the future?" Entity types are broad: person, company, vendor, product, purchase order, event, project, marketing campaign, process, pricing structure, seasonal pattern — anything that accumulates context over time
- **One-off details go on existing pages**: Only create a new page when the entity will be referenced from multiple pages or connects multiple other entities
- **Read before updating**: Before modifying an existing page, read it first. Only add information not already present. Do not reorganize or rewrite existing content unless it's factually wrong.

### When to create vs. update

- **Create**: entity has no existing context page and will accumulate context over time
- **Update**: existing page found — add only new information

### Page format

Follow `context/SCHEMAS.md` for tag taxonomy, section ordering, and per-entity-type required fields.

After any write:
- Update `last_updated` in frontmatter to today's date
- Add cross-links in `## Related` if new relationships were identified

### Context Backfill

Context updates from session work are handled automatically by the scheduled context backfill process. The server periodically indexes completed session transcripts into `context/sessions/` and launches a curation session to update curated pages. Sessions do not need to update context before stopping.

---

## CLI Reference

```bash
# BigQuery
BQ="node .claude/skills/google-bigquery/scripts/client.js"
$BQ query "<sql>"

# Gmail + Drive + Calendar + Sheets
GW="node .claude/skills/google-workspace/scripts/client.js"
$GW get-thread --id <thread-id>
$GW gmail-search --query "<query>" --max 10
$GW create-draft --to "<to>" --subject "Re: <subject>" --body "<body>" --thread-id <id>
$GW drive-search --query "name contains '<name>'" --limit 10

# Notion
NOTION="node .claude/skills/notion/scripts/client.js"
$NOTION search --query "<query>"
$NOTION notion-to-md --page-id <page-id>
$NOTION create-database-page --database-id <db-id> --title "Title" --content "<markdown>"

# qmd (knowledge index — covers all of context/)
qmd search "<keyword>" -c hammies-context    # BM25 keyword search (fast, exact terms)
qmd vsearch "<query>" -c hammies-context     # vector similarity search
qmd query "<question>" -c hammies-context    # full hybrid: expansion + BM25 + vector + reranking (best quality)
qmd update                                   # re-index after adding files
qmd embed                                    # generate vector embeddings
# Or use the qmd_deep_search MCP tool for semantic search from within Claude
```
