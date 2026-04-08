---
name: render-output
description: "Guidelines for rendering visual output in the inbox UI. Covers create_file + present_files (preferred for React artifacts), render_output (for tables/charts/markdown), and available libraries. Activate when the agent needs to render visual output, create interactive UIs, display charts, or build dashboards."
---

# Rendering Output

Two ways to render rich content in the session transcript. Outputs appear at 600×600px and expand to a full panel.

## 1. create_file + present_files (preferred for React)

Write a file, then present it. The file extension determines how it renders.

```
1. create_file(description, path, file_text)
2. present_files(filepaths)
```

**Renderable extensions:**
- `.jsx` → React component (interactive UIs, dashboards, forms)
- `.html` → HTML page (single file, JS/CSS inline)
- `.md` → Markdown with syntax highlighting
- `.svg` → SVG image

**Path convention:** `/mnt/user-data/outputs/<name>.<ext>`

**Updating:** Call `create_file` again with the same path, then `present_files` again. Only the latest version renders.

## 2. render_output (for structured data)

Single tool call with `type` and `data`. Best for non-interactive output:

| Type | When to use | Example |
|------|-------------|---------|
| **text** (no tool) | Simple answers, confirmations | "Done — email draft saved" |
| **table** | Tabular data with rows/columns | Email lists, query results |
| **chart** | Numeric data visualization | Trends, distributions |
| **markdown** | Formatted text | Reports, summaries |
| **json** | Data inspection | API responses, configs |
| **react** | Interactive UI (same as .jsx) | Dashboards, forms |

## When to Use Artifacts vs Text

**Use artifacts when** the user benefits from *seeing* or *interacting with* the response:
- Interactive forms, dashboards, data explorers
- Charts and data visualizations
- Tables with 5+ rows
- Code longer than 20 lines
- Multi-section layouts

**Stay inline (plain text) when:**
- Simple answers, confirmations
- Lists under 10 items
- Short code snippets (<20 lines)
- Single-paragraph responses
- Casual tone from user

**When in doubt, respond inline.** Artifacts add latency.

**Generated files:** Always render files immediately. Never just report a save path — show the result.

## React Artifacts

### Environment

- **Tailwind CSS** — all styling via utility classes
- **shadcn/ui** — `import { Button, Badge, ... } from "@hammies/frontend/components/ui"`
- **React hooks** — `import { useState, useEffect, ... } from "react"`
- **Utilities** — `import { cn } from "@hammies/frontend/lib/utils"`
- **Charts** — `import { LineChart, BarChart, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Line, Bar, Area, Pie, Cell, ResponsiveContainer } from "recharts"`
- **Icons** — `import { Search, Mail, Check, X, ... } from "lucide-react"`
- **Data viz** — `import * as d3 from "d3"`
- **Utilities** — `import _ from "lodash"`

**IMPORTANT:** Always use ES module `import` syntax. NEVER use `require()` or `window["..."]`.

### Globals (do not import)

- **`sendAction(intent, data?)`** — Sends a message to the agent. Include relevant component state in `data` so the agent has context. Use only when the agent needs to process the action (submit form, approve/reject, update record).
  - Agent receives: `<artifact_action intent="approve">{ "itemId": 123 }</artifact_action>`
- **`saveState(state)`** — Persist UI state across page reloads. Restored automatically on remount via `window.__onStateRestored`.

**Links vs sendAction:** Use `<a href="..." target="_blank">` for URLs the user should open directly. Use `sendAction` only when the agent must respond to the click.

### Restrictions

- **No localStorage or sessionStorage** — use React state instead
- **No fetch() to external APIs** — use `sendAction` to request the agent do it
- **No document.cookie**

### Design Rules

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

**Layout:** `flex flex-col` (stacks), `flex items-center justify-between` (rows), `flex-1 min-w-0` (shrinkable items), `shrink-0` (icons/buttons). **Tabs must stack vertically** (TabsList above TabsContent) — never side-by-side.

### Error Handling

Always handle loading and error states:
- Use `Skeleton` for loading placeholders
- Use `Alert` with `variant="destructive"` for errors
- Show data progressively rather than blocking the entire UI

### Available Components

Import from `@hammies/frontend/components/ui`:

Button, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Badge, Input, Textarea, Label, Select, SelectTrigger, SelectValue, SelectContent, SelectItem, Separator, Switch, Checkbox, Tabs, TabsList, TabsTrigger, TabsContent, Table, TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell, TableCaption, Skeleton, Progress, Avatar, AvatarImage, AvatarFallback, Accordion, AccordionItem, AccordionTrigger, AccordionContent, Alert, AlertTitle, AlertDescription, Toggle, ToggleGroup, ToggleGroupItem, RadioGroup, RadioGroupItem, Spinner, cn

### Component Patterns

See `references/component-patterns.md` for complete examples.
See `references/app-components.md` for real-world examples from the Inbox app.

## HTML Outputs

HTML outputs (`.html` files and `type: "html"`) render inside a sandboxed iframe. The app injects CSS theme variables (`--foreground`, `--background`, `--border`, etc.) onto `:root`, so they are available via `var()`.

### Styling Rules

- **Never hardcode colors** — no `color: #1a1a1a`, `background: white`, or any hex/rgb values. Use CSS variables: `var(--foreground)`, `var(--background)`, `var(--muted-foreground)`, etc.
- **Never set font-family** — the app provides `var(--font-sans)` on `body`
- **No root-level styling** — don't set `max-width`, `padding`, `color`, `background`, or `font-family` on the root element or `<body>`. The app handles these.
- **Available color variables**: `--foreground`, `--background`, `--muted-foreground`, `--primary`, `--primary-foreground`, `--secondary`, `--secondary-foreground`, `--border`, `--card`, `--card-foreground`, `--accent`, `--accent-foreground`, `--chart-1` through `--chart-5`
- **Tailwind is NOT available** in HTML outputs (unlike React artifacts). Use plain CSS with `var()` references.

### Template

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  h2 { font-size: 14px; font-weight: 600; }
  p { font-size: 14px; }
  .secondary { font-size: 12px; color: var(--muted-foreground); }
  .border-b { border-bottom: 1px solid var(--border); }
  a { color: var(--primary); }
</style>
</head>
<body>
  <h2>Title</h2>
  <p>Content inherits foreground color from the app theme.</p>
  <p class="secondary">Secondary text.</p>
</body>
</html>
```

**Prefer React artifacts (`.jsx`)** over HTML for anything interactive or complex. HTML outputs are best for simple static content or reports.

## Table (render_output)
```json
{
  "type": "table",
  "data": {
    "columns": ["Name", "Status", "Updated"],
    "rows": [["Widget A", "Active", "2024-03-15"]]
  }
}
```

Auto-pagination at 20+ rows, auto-search at 5+ rows. Columns are sortable.

## Chart (render_output)
```json
{
  "type": "chart",
  "data": {
    "type": "bar",
    "data": [{"month": "Jan", "revenue": 1200}],
    "xKey": "month",
    "yKeys": ["revenue"],
    "colors": {"revenue": "var(--chart-1)"}
  }
}
```

Chart types: `bar`, `line`, `area`, `pie`. For complex charts, use a `.jsx` artifact with recharts.
