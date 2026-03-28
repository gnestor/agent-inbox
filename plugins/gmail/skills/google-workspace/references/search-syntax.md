# Google Drive Search Query Syntax

Complete reference for Google Drive search queries.

## Basic Syntax

Google Drive search queries use a structured syntax with operators and values:

```
field operator 'value'
```

Multiple conditions can be combined with `and`, `or`, and `not`.

## Field Operators

### Equality Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `=` | Equals | `name = 'Document.pdf'` |
| `!=` | Not equals | `mimeType != 'application/pdf'` |
| `contains` | Contains text | `name contains 'report'` |

### Comparison Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `>` | Greater than | `modifiedTime > '2025-01-01T00:00:00'` |
| `>=` | Greater than or equal | `createdTime >= '2025-01-01T00:00:00'` |
| `<` | Less than | `modifiedTime < '2025-12-31T23:59:59'` |
| `<=` | Less than or equal | `createdTime <= '2025-12-31T23:59:59'` |

### Membership Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `in` | Is in collection | `'me' in owners` |
| `has` | Contains any | `'user@example.com' in writers` |

## Searchable Fields

### File Metadata

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `name` | string | File name | `name contains 'budget'` |
| `fullText` | string | File content and name | `fullText contains 'quarterly report'` |
| `mimeType` | string | MIME type | `mimeType = 'application/pdf'` |
| `modifiedTime` | datetime | Last modified time | `modifiedTime > '2025-11-01T00:00:00'` |
| `createdTime` | datetime | Creation time | `createdTime >= '2025-01-01T00:00:00'` |
| `viewedByMeTime` | datetime | Last viewed by me | `viewedByMeTime > '2025-11-01T00:00:00'` |

### Boolean Fields

| Field | Description | Example |
|-------|-------------|---------|
| `starred` | File is starred | `starred = true` |
| `trashed` | File is in trash | `trashed = false` |
| `sharedWithMe` | Shared with me | `sharedWithMe = true` |
| `hidden` | File is hidden | `hidden = false` |

### Ownership & Sharing

| Field | Description | Example |
|-------|-------------|---------|
| `owners` | File owners | `'user@example.com' in owners` |
| `writers` | Users with write permission | `'user@example.com' in writers` |
| `readers` | Users with read permission | `'user@example.com' in readers` |
| `sharingUser` | User who shared the file | `sharingUser = 'user@example.com'` |

### Organization

| Field | Description | Example |
|-------|-------------|---------|
| `parents` | Parent folders | `'1abc123' in parents` |
| `properties` | Custom properties | `properties has { key='department' and value='marketing' }` |

## Combining Queries

### Logical Operators

```
# AND - both conditions must be true
"name contains 'report' and mimeType = 'application/pdf'"

# OR - either condition can be true
"mimeType = 'image/jpeg' or mimeType = 'image/png'"

# NOT - condition must be false
"not mimeType contains 'google-apps'"
```

### Grouping with Parentheses

```
"(name contains 'report' or name contains 'summary') and mimeType = 'application/pdf'"
```

## Date/Time Format

Dates must be in RFC 3339 format (ISO 8601):

```
YYYY-MM-DDTHH:MM:SS[.sss][Z|+HH:MM]
```

## Common Query Patterns

### Find Files by Name
```
"name contains 'budget'"
"name contains 'Q4' and name contains 'report'"
```

### Find Files by Type
```
"mimeType = 'application/pdf'"
"mimeType contains 'image/'"
"mimeType contains 'application/vnd.google-apps'"
```

### Find Files by Date
```
"modifiedTime > '2025-11-06T00:00:00'"
"createdTime > '2025-01-01T00:00:00' and createdTime < '2025-02-01T00:00:00'"
```

### Find Files by Location
```
"'1abc123' in parents"
"'root' in parents"
"sharedWithMe = true"
```

### Find Files by Ownership
```
"'me' in owners"
"'user@example.com' in owners"
```

### Find Files by Content
```
"fullText contains 'quarterly earnings'"
```

## Limitations

1. **File Size**: Cannot directly search by file size (must filter results)
2. **File Content**: Full-text search is limited to certain file types
3. **Wildcards**: No traditional wildcards - use `contains` instead
4. **Regular Expressions**: Not supported in search queries

## Performance Tips

1. **Be specific**: More specific queries return faster
2. **Use MIME types**: Filtering by type is faster than content search
3. **Use parent folders**: Searching within folders is faster than global search
4. **Avoid fullText**: Full-text search is slower than name-based search
5. **Use date ranges**: Narrow date ranges improve performance
