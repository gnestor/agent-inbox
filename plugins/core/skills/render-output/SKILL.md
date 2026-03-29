---
name: render-output
description: "Guidelines for the render_output MCP tool — choosing output types, designing React artifacts, and using shadcn/ui components. Activate when: the agent needs to render visual output, create a dashboard, build an interactive form, display a chart or table, or when render_output quality needs improvement."
---

# Render Output

The `render_output` MCP tool renders structured outputs inline in the session transcript. Outputs appear at 600×600px and expand to a full panel (600px × viewport height).

## Choosing the Right Type

| Type | When to use | Example |
|------|-------------|---------|
| **text** (no tool) | Simple answers, confirmations, short explanations | "Done — email draft saved to Notion" |
| **markdown** | Long-form content with headings, code blocks, structured prose | Reports, documentation, multi-section summaries |
| **table** | Tabular data with multiple fields per row | Email lists, task comparisons, query results |
| **chart** | Numeric data that benefits from visualization | Trends over time, distributions, metric comparisons |
| **json** | Structured data for inspection | API responses, config dumps, raw data |
| **react** | Interactive UIs — click, filter, sort, submit | Dashboards, approval workflows, forms, data explorers |
| **file** | Generated files that should display inline | AI-generated images, exported reports, PDFs |

**Key principle:** Use `render_output` when the user would benefit from _seeing_ or _interacting with_ the response. Don't force everything into artifacts — short answers stay as plain text.

**Generated files:** Always render files immediately with `type: "file"` and the absolute path. Never just report the save path — show the result.

## React Artifacts

### Environment

- **Tailwind CSS** — all styling via utility classes
- **shadcn/ui** — import from `@hammies/frontend/components/ui`
- **React hooks** — import from `react`

### Globals (do not import)

- **`sendAction(intent, data?)`** — Send an action back to the session for agent follow-up. Include relevant component state in `data` so the agent has context. The agent receives: `<artifact_action intent="...">JSON</artifact_action>`.
- **`saveState(state)`** — Persist UI state across page reloads. Restored automatically on remount.

### Design Rules

Follow these to match the app's visual style:

**Root element:** No `bg-background`, `bg-card`, `text-foreground`, or `p-*`. The app provides background, text color, and padding. Start with bare layout: `<div className="flex flex-col gap-4">`.

**Colors:**
- `text-muted-foreground` — secondary text
- `hover:bg-secondary` — hover states
- `bg-primary text-primary-foreground` — selected/active
- `bg-accent text-accent-foreground` — highlights/links
- `bg-card` — only on Card components, never wrapper divs
- `text-chart-1` through `text-chart-5` — data visualization (5 distinct hues)

**Typography:**
- `text-sm font-semibold` — headings
- `text-sm font-medium` — primary content
- `text-xs text-muted-foreground` — secondary/metadata
- Never use `text-base` or `text-lg`

**Spacing:** `p-4` or `px-4 py-3` (content), `gap-2` (default), `gap-4` (sections)

**Borders:** `border border-border rounded-lg` (containers), `border-b` (list separators), `rounded-md` (buttons/inputs)

**Layout:** `flex flex-col` (stacks), `flex items-center justify-between` (rows), `flex-1 min-w-0` (shrinkable items), `shrink-0` (icons/buttons)

### Available Components

Import from `@hammies/frontend/components/ui`:

Button, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Badge, Input, Textarea, Label, Select, SelectTrigger, SelectValue, SelectContent, SelectItem, Separator, Switch, Checkbox, Tabs, TabsList, TabsTrigger, TabsContent, Table, TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell, TableCaption, Skeleton, Progress, Avatar, AvatarImage, AvatarFallback, Accordion, AccordionItem, AccordionTrigger, AccordionContent, Alert, AlertTitle, AlertDescription, Toggle, ToggleGroup, ToggleGroupItem, RadioGroup, RadioGroupItem, Spinner, cn

### Component Patterns

See `references/component-patterns.md` for complete examples of each component and common compositions.

See `references/app-components.md` for examples based on real components in the Inbox app (data tables, rich text editors, property editors, list views).

## Other Output Types

### Table
```json
{
  "type": "table",
  "data": {
    "columns": ["Name", "Status", "Updated"],
    "rows": [["Widget A", "Active", "2024-03-15"], ["Widget B", "Draft", "2024-03-10"]]
  }
}
```

Auto-pagination at 20+ rows, auto-search at 5+ rows. Columns are sortable.

### Chart
```json
{
  "type": "chart",
  "data": {
    "type": "bar",
    "data": [{"month": "Jan", "revenue": 1200}, {"month": "Feb", "revenue": 1800}],
    "xKey": "month",
    "yKeys": ["revenue"],
    "labels": {"revenue": "Monthly Revenue"},
    "colors": {"revenue": "var(--chart-1)"}
  }
}
```

Chart types: `bar`, `line`, `area`, `pie`. Uses chart-1 through chart-5 color tokens.

### Markdown
Supports GitHub-flavored Markdown with syntax-highlighted code blocks.

### File
```json
{
  "type": "file",
  "data": { "name": "report.pdf", "path": "/absolute/path/to/report.pdf", "mimeType": "application/pdf" }
}
```

Images and videos render inline. Other files show a download link.
