import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk"
import { z } from "zod"

/**
 * Builds an in-process MCP server that registers the `render_output` tool.
 *
 * When the agent calls `render_output`, the tool handler returns a brief
 * acknowledgment. The frontend detects `block.name === "render_output"` in
 * the session transcript and renders the appropriate component.
 */
export function buildRenderOutputMcpServer() {
  const renderOutputTool = tool(
    "render_output",
    `Render a structured output in the inbox UI. The output appears inline in the session transcript (600px x 600px) and can be expanded to its own panel (600px x calc(100vh - 77px)).

UPDATING: To update or fix a previously rendered output, call render_output again with the same title. The previous version is automatically replaced — only the latest version is shown. Use this to iterate on errors, apply user-requested changes, or refine outputs without cluttering the session.

For type "react": the sandbox includes Tailwind CSS, the app's shadcn/ui dark theme, and shadcn components from @hammies/frontend. Use Tailwind classes for all styling unless absolutely necessary.

COMPONENTS — Import from '@hammies/frontend/components/ui'. 

Available: Button, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Badge, Input, Textarea, Label, Select, SelectTrigger, SelectValue, SelectContent, SelectItem, Separator, Switch, Checkbox, Tabs, TabsList, TabsTrigger, TabsContent, Table, TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell, TableCaption, Skeleton, Progress, Avatar, AvatarImage, AvatarFallback, Accordion, AccordionItem, AccordionTrigger, AccordionContent, Alert, AlertTitle, AlertDescription, Toggle, ToggleGroup, ToggleGroupItem, RadioGroup, RadioGroupItem, Spinner, cn.

COMPONENT PATTERNS — follow these exactly:
- Tabs: <Tabs defaultValue="tab1"><TabsList><TabsTrigger value="tab1">Tab 1</TabsTrigger></TabsList><TabsContent value="tab1">Content here</TabsContent></Tabs>
- Card: <Card><CardHeader><CardTitle>Title</CardTitle></CardHeader><CardContent>Body</CardContent></Card>
- Table: <Table><TableHeader><TableRow><TableHead>Col</TableHead></TableRow></TableHeader><TableBody><TableRow><TableCell>Val</TableCell></TableRow></TableBody></Table>
- Form: <div className="flex flex-col gap-3"><Label>Name</Label><Input placeholder="..." /><Button>Submit</Button></div>
- Select: <Select><SelectTrigger><SelectValue placeholder="Choose..." /></SelectTrigger><SelectContent><SelectItem value="a">Option A</SelectItem></SelectContent></Select>

CRITICAL: Your root element must NOT have bg-background, bg-card, text-foreground, or padding (p-*). The app already provides background, text color, and padding. Start your component with bare layout (e.g. <div className="flex flex-col gap-4">).

DESIGN RULES — follow these patterns to match the app:
- Colors: text-muted-foreground (secondary text), hover:bg-secondary (hover states), bg-primary text-primary-foreground (selected/active), bg-accent text-accent-foreground (highlights/links). Use bg-card only on Card components, never on wrapper divs.
- Chart colors: text-chart-1 through text-chart-5 (or bg-chart-*) for data visualization — 5 distinct hues
- Font: font-sans (default), font-mono (code/data)
- Typography: text-sm font-semibold (headings), text-sm font-medium (primary content), text-xs text-muted-foreground (secondary/metadata). Never use text-base or text-lg.
- Spacing: p-4 or px-4 py-3 (content areas), gap-2 (default flex gap), gap-4 (section separation)
- Borders: border border-border rounded-lg (containers), border-b (list separators), rounded-md (buttons/inputs)
- Layout: flex flex-col (vertical stacks), flex items-center justify-between (rows), flex-1 min-w-0 (shrinkable flex items), shrink-0 (icons/buttons)
- Icon buttons: p-1.5 rounded-md hover:bg-secondary text-muted-foreground
- Lists: px-4 py-3 border-b per item, flex items-center gap-2
- Forms: grid or flex-col with gap-2, Label above Input/Textarea/Select. Inputs inside bordered containers should use border-none to avoid double borders.
- Empty states: flex flex-col items-center justify-center p-8 text-muted-foreground

Import React hooks from 'react':
  import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
Export your root component as default or name it App.

GLOBALS available in artifact code (do not import):

sendAction(intent: string, data?: object) — Sends a message to the session. The agent receives the intent and can respond. Always include relevant component state in the data argument so the agent has full context.
  Examples:
  - sendAction('approve', { itemId: 123 })
  - sendAction('submit_form', { to, subject, body })
  - sendAction('update_row', { rowId: 5, field: 'status', value: 'done' })
  The agent receives: <artifact_action intent="approve">{ "itemId": 123 }</artifact_action> — parse the intent attribute and JSON body.
  Use this for: approval/reject buttons, form submissions, row actions, navigation requests, or any user interaction that should trigger an agent response.

saveState(state: object) — Persists UI state across page reloads. Automatically restored on remount via window.__onStateRestored callback.
  Example: saveState({ selectedTab: 'details', scrollY: 100 })`,
    {
      type: z.enum(["markdown", "html", "table", "json", "chart", "file", "conversation", "react"]).describe(
        "Choose the simplest type that represents the data well:\n" +
        "- table: structured data with rows/columns (orders, line items, comparisons)\n" +
        "- json: raw data inspection, API responses, debug output\n" +
        "- markdown: formatted text with headings, lists, links\n" +
        "- html: formatted content needing custom styling\n" +
        "- chart: bar/line/area/pie data visualization\n" +
        "- react: custom UI that doesn't fit the other types (interactive forms, multi-section layouts, styled cards). Requires writing JSX code as a string.\n" +
        "- file: reference to a file on disk\n" +
        "- conversation: chat-style message list"
      ),
      data: z.any().describe(
        "Content format depends on type:\n" +
        "- markdown/html: string\n" +
        "- table: { columns: string[], rows: any[][] }\n" +
        "- json: any JSON value\n" +
        "- chart: { type?: 'bar'|'line'|'area'|'pie', data: [{xField: val, yField: val}...], xKey: string, yKeys: string[], labels?: {key: label}, colors?: {key: cssColor} }\n" +
        "- file: { name: string, path: string, mimeType?: string }\n" +
        "- conversation: { messages: [{role, content}] }\n" +
        "- react: { code: string, title?: string } — code MUST be a string of JSX/React code, NOT a data object. If you just have data to display, use 'table' or 'json' instead."
      ),
      title: z.string().describe("Title shown above the output. Also used as the key for updates — calling render_output again with the same title replaces the previous version."),
    },
    async (args) => {
      if (args.type === "react") {
        const code = typeof args.data === "string" ? args.data : args.data?.code
        if (!code || typeof code !== "string") {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: type "react" requires data to be { code: "<JSX string>" } or a plain string of JSX code. You passed a data object without a code field. Use type "table" or "json" instead if you just want to display data.`,
              },
            ],
            isError: true,
          }
        }
      }
      let detail: string
      switch (args.type) {
        case "react": {
          const code = typeof args.data === "string" ? args.data : args.data?.code
          detail = `react component (${code.length} chars)`
          break
        }
        case "table":
          detail = `table: ${args.data?.columns?.length ?? 0} columns, ${args.data?.rows?.length ?? 0} rows`
          break
        case "markdown":
        case "html":
          detail = `${args.type}: ${typeof args.data === "string" ? args.data.length : 0} chars`
          break
        default:
          detail = args.type
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `Output rendered: ${args.title || "(untitled)"} — ${detail}`,
          },
        ],
      }
    }
  )

  return createSdkMcpServer({
    name: "render_output",
    version: "1.0.0",
    tools: [renderOutputTool],
  })
}
