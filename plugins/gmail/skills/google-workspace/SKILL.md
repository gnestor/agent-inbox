---
name: google-workspace
description: Google Workspace integration covering Gmail, Google Drive, Google Sheets, and Google Calendar. Activate when the user asks about email, calendar, spreadsheets, file management, or Google Drive. Handles reading/writing emails, managing calendar events, spreadsheet operations, and file storage.
---

# Google Workspace

## Purpose

This skill enables interaction with Google Workspace services (Gmail, Drive, Sheets, Calendar) using the `~~workspace` client script. Provides comprehensive access to email, file management, spreadsheets, and calendars.

## When to Use

Activate this skill when the user:
- Asks about emails, inbox management, or sending emails (Gmail)
- Wants to search, download, upload, or organize files (Drive)
- Needs to read, write, or create spreadsheets (Sheets)
- Asks about calendar events, scheduling, or availability (Calendar)

## When NOT to Use

- **Shopify data**: Use shopify skill
- **Database queries**: Use postgresql skill
- **Website analytics**: Use google-analytics skill

## Client Script

**Path:** `skills/google-workspace/scripts/client.js`

### Commands

#### Gmail
| Command | Description |
|---------|-------------|
| `gmail-search` | Search Gmail messages (--query) [--max] |
| `gmail-list-unread` | List unread Gmail messages [--max] |
| `gmail-list-important` | List important Gmail messages [--max] |
| `gmail-get` | Get full email with decoded body (--id) |
| `gmail-get-thread` | Get all messages in a thread (--thread-id) |
| `gmail-send` | Send email (--to, --subject, --body) [--cc, --bcc, --reply-to, --thread-id] |
| `gmail-create-draft` | Create a draft (--to, --subject, --body) [--thread-id, --in-reply-to, --cc, --html] |
| `gmail-manage-labels` | Add/remove labels (--id) [--add, --remove] — use to archive (`--remove INBOX`) or mark read (`--remove UNREAD`) |
| `gmail-batch-modify` | Batch add/remove labels on messages (--ids comma-separated) [--add, --remove] |
| `gmail-list-attachments` | List attachments for a message (--id) |
| `gmail-get-attachment` | Download attachment to disk (--id, --attachment-id, --output) |
| `gmail-list-threads` | List Gmail threads [--query, --max] |
| `gmail-list-labels` | List all Gmail labels |
| `gmail-get-profile` | Get Gmail account profile (email address, message count, etc.) |

#### Drive
| Command | Description |
|---------|-------------|
| `drive-search` | Search Drive files (--query) [--limit] |
| `drive-list` | List files in folder (--folder-id) [--limit] |
| `drive-get` | Get file metadata (--id) |
| `drive-download` | Download/export a file (--id) [--mime-type] |
| `drive-upload` | Upload file content (--name, --content) [--parent-id, --mime-type, --content-type] |
| `drive-update` | Update file content from local file (--id, --file-path) [--mime-type] |
| `drive-update-metadata` | Update file metadata (--id, --body JSON) — rename, star, description |
| `drive-create-folder` | Create a folder (--name) [--parent-id] |
| `drive-move` | Move file to a folder (--id, --parent-id) |
| `drive-copy` | Copy a file (--id) [--name, --parent-id] |
| `drive-trash` | Move file to trash (--id) |
| `drive-delete` | Permanently delete file (--id) |
| `drive-share` | Share a file (--id, --role, --email) [--type: user/group/anyone] |
| `drive-list-permissions` | List permissions on a file (--id) |
| `drive-remove-permission` | Remove a permission from a file (--id, --permission-id) |
| `drive-list-revisions` | List revision history for a file (--id) |

#### Sheets
| Command | Description |
|---------|-------------|
| `sheets-list` | List sheets in spreadsheet (--id) |
| `sheets-get-range` | Get values (--id, --range) [--render-option] |
| `sheets-batch-get` | Get multiple ranges (--id, --ranges JSON array) [--render-option] |
| `sheets-update-range` | Update values (--id, --range, --values JSON) |
| `sheets-batch-update` | Update multiple ranges (--id, --data JSON [{range,values}]) |
| `sheets-append` | Append rows (--id, --range, --values JSON) |
| `sheets-clear` | Clear a range (--id, --range) |
| `sheets-batch-clear` | Clear multiple ranges (--id, --ranges JSON array) |
| `sheets-create` | Create spreadsheet (--title) [--sheet-titles comma-separated] |
| `sheets-copy-sheet` | Copy sheet to another spreadsheet (--id, --sheet-id, --dest-id) |
| `sheets-batch-update-spreadsheet` | Apply formatting/structural changes (--id, --requests JSON) |
| `sheets-get` | Get full spreadsheet metadata and structure (--id) [--ranges, --fields] |

#### Calendar
| Command | Description |
|---------|-------------|
| `calendar-list-calendars` | List all accessible calendars |
| `calendar-get-calendar` | Get calendar metadata [--calendar-id] |
| `calendar-list` | List events [--calendar-id, --time-min, --time-max, --max] |
| `calendar-get-event` | Get specific event (--event-id) [--calendar-id] |
| `calendar-create` | Create event (--summary, --start, --end) [--calendar-id, --description, --location, --attendees, --start-date, --end-date, --timezone] |
| `calendar-update` | Update event (--event-id) [--calendar-id, --summary, --start, --end, ...] |
| `calendar-delete` | Delete event (--event-id) [--calendar-id] |
| `calendar-freebusy` | Query free/busy (--time-min, --time-max, --calendars comma-separated IDs) |
| `calendar-quick-add` | Create event from natural language (--text) [--calendar-id] |
| `calendar-list-instances` | List instances of a recurring event (--event-id) [--calendar-id, --time-min, --time-max, --max] |
| `calendar-move` | Move event to another calendar (--event-id, --destination) [--calendar-id] |
| `calendar-colors` | Get available calendar and event color definitions |

## Key API Concepts

**Gmail:** Search syntax (`from:`, `to:`, `is:unread`, `has:attachment`, etc.). Messages are fetched with full body decoding.

**Drive:** Search syntax (`name contains 'X'`, `mimeType='...'`). Google Workspace files must be exported (Docs->PDF/text, Sheets->CSV/XLSX).

**Sheets:** A1 notation for ranges (e.g., `'Sheet1!A1:D10'`). Values are 2D arrays. Render options: formatted, unformatted, formula.

**Calendar:** ISO 8601 datetime format with timezone. All-day events use date instead of dateTime.

## For Complex Operations

```javascript
import { apiRequest } from '../../../lib/http.js';
// Gmail
const messages = await apiRequest('google-workspace', '/gmail/v1/users/me/messages?q=is:unread', { baseUrlOverride: 'https://gmail.googleapis.com' });
// Drive
const files = await apiRequest('google-workspace', '/drive/v3/files?q=name contains "budget"', { baseUrlOverride: 'https://www.googleapis.com' });
```

## Gmail Search Syntax Reference

Common search operators:

- `from:sender@email.com` - Emails from specific sender
- `to:recipient@email.com` - Emails to specific recipient
- `subject:keyword` - Emails with keyword in subject
- `is:unread` - Unread emails
- `is:important` - Important emails
- `is:starred` - Starred emails
- `has:attachment` - Emails with attachments
- `after:YYYY/MM/DD` - Emails after date
- `before:YYYY/MM/DD` - Emails before date
- `newer_than:2d` - Emails newer than 2 days (d=days, m=months, y=years)
- `older_than:1m` - Emails older than 1 month
- `label:labelname` - Emails with specific label
- `-label:inbox` - Emails not in inbox (archived)

Combine operators with spaces for AND, or use `OR` for alternatives.

## Drive Search Syntax Reference

Google Drive queries use structured syntax: `field operator 'value'`

**By name:** `name contains 'budget'`
**By type:** `mimeType='application/vnd.google-apps.spreadsheet'`
**By date:** `modifiedTime > '2025-01-01T00:00:00'`
**By owner:** `'me' in owners`
**Shared files:** `sharedWithMe = true`
**In folder:** `'FOLDER_ID' in parents`
**Content search:** `fullText contains 'quarterly report'`

Combine with `and`, `or`, `not`. Use parentheses for grouping.

### Export Formats for Google Workspace Files

| File Type | Format | MIME Type |
|-----------|--------|-----------|
| Google Docs | PDF | `application/pdf` |
| Google Docs | DOCX | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` |
| Google Docs | Plain Text | `text/plain` |
| Google Sheets | XLSX | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` |
| Google Sheets | CSV | `text/csv` |
| Google Sheets | PDF | `application/pdf` |
| Google Slides | PPTX | `application/vnd.openxmlformats-officedocument.presentationml.presentation` |
| Google Slides | PDF | `application/pdf` |

Non-Google Workspace files (uploaded PDFs, images, Office files) download directly without export.

## Sheets Tips & Gotchas

### Date Serial Numbers

Google Sheets stores dates as serial numbers (0 = December 30, 1899). When a date formula returns 0 or no match, it displays as "12/30/1899".

**Fix:** Wrap date formulas in IF to return blank instead of 0:
```
# Bad - shows 12/30/1899 when no match:
=MAXIFS(DateRange, CriteriaRange, "*search*")

# Good - shows blank when no match:
=IF(COUNTIF(CriteriaRange,"*search*")=0, "", MAXIFS(DateRange, CriteriaRange, "*search*"))
```

### Currency Values Stored as Text

Strip formatting before calculations when values contain `$` symbols:
```
=VALUE(SUBSTITUTE(SUBSTITUTE(A1,"$",""),",",""))
```

### Type Mismatches in VLOOKUP/MATCH

VLOOKUP and MATCH are type-sensitive. Text `"1234"` won't match number `1234`. Use `TEXT(value,"@")` to normalize.

### ARRAYFORMULA Limitations

`COUNTIF`, `MATCH`, and `INDEX/MATCH` do NOT work inside `ARRAYFORMULA`. Use `VLOOKUP` (works in ARRAYFORMULA) or the `REGEXMATCH+JOIN` pattern for array-compatible lookups.

Use `LEN()=0` instead of `=""` for empty checks with mixed types. Prefer bounded ranges (A2:A100) over open-ended ranges (A2:A).

### Render Options

- **formatted**: Display values like "($1,234.56)", "15%" (default)
- **unformatted**: Raw numeric values like -1234.56, 0.15 (best for calculations)
- **formula**: Formula text like "=SUM(A1:A10)"

## Calendar Date/Time Format Reference

- **ISO 8601 with timezone** (recommended): `2026-01-28T10:00:00-08:00`
- **ISO 8601 UTC**: `2026-01-28T18:00:00Z`
- **All-day events**: Use `date` instead of `dateTime`: `{"date": "2026-01-28"}`

### Event JSON Format

```json
{
  "summary": "Event Title",
  "description": "Event description",
  "location": "Meeting room or address",
  "start": { "dateTime": "2026-01-28T10:00:00-08:00" },
  "end": { "dateTime": "2026-01-28T11:00:00-08:00" },
  "attendees": [{ "email": "person@example.com" }]
}
```

## Hammies Calendars

| Calendar | ID | Description |
|----------|----|-------------|
| Work | `grant@hammies.com` | Primary work calendar |
| Personal | `grantnestor@gmail.com` | Personal calendar |

Use both when checking availability with `calendar-freebusy`.

## Reference Files
- [workflow-examples.md](references/workflow-examples.md) — Step-by-step examples for Drive and Sheets operations
- [financial-sheets.md](references/financial-sheets.md) — Spreadsheet IDs for P&L, Balance Sheet, Marketing KPIs, Inventory
- [search-syntax.md](references/search-syntax.md) — Drive search query syntax and operators
- [mime-types.md](references/mime-types.md) — Complete MIME type reference for Drive files
- [export-formats.md](references/export-formats.md) — Export format options for Google Workspace files
