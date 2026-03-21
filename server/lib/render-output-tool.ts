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
    `Render a structured output in the inbox UI. The output appears inline in the session transcript.

For type "react": the sandbox includes Tailwind CSS and a shadcn/ui dark theme. Use Tailwind classes for ALL styling — never use inline styles.

COMPONENTS (use instead of raw HTML elements):
Button (variant: primary|secondary|destructive|outline|ghost, size: sm|md|lg|icon), Card, Badge (variant: default|secondary|outline), Input, Textarea, Select, Label, Switch (checked, onCheckedChange), Separator (orientation: horizontal|vertical).

DESIGN RULES — follow these patterns to match the app:
- Colors: bg-background (base), bg-card (containers), text-foreground (primary text), text-muted-foreground (secondary text), hover:bg-secondary (hover states), bg-primary text-primary-foreground (selected/active), bg-accent text-accent-foreground (highlights/links)
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

React 18 + hooks (useState, useEffect, useRef, useCallback, useMemo, useReducer, useContext, createContext) are globals — do NOT import them. Export your root component as default or name it App.`,
    {
      type: z.enum(["markdown", "html", "table", "json", "chart", "file", "conversation", "react"]),
      data: z.any().describe(
        "Output content. Format depends on type: " +
        "markdown/html = string, " +
        "table = { columns: string[], rows: any[][] }, " +
        "json = any, " +
        "chart = Vega-Lite spec object, " +
        "file = { name: string, path: string, mimeType?: string }, " +
        "conversation = { messages: [{role, content}] }, " +
        "react = { code: string, title?: string }"
      ),
      title: z.string().optional().describe("Optional title shown above the output"),
      panel: z.boolean().optional().default(false).describe(
        "Unused — outputs always render inline. Users can maximize to a panel via the UI."
      ),
    },
    async (args) => {
      return {
        content: [
          {
            type: "text" as const,
            text: `Output rendered: ${args.title || args.type}`,
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
