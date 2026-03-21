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
    `Render a structured output in the inbox UI. The output appears inline in the session transcript. Use panel: true to open it as a side panel.

For type "react": the sandbox includes Tailwind CSS and a shadcn/ui-compatible dark theme. Use Tailwind utility classes for all styling (e.g. bg-card, text-foreground, border, rounded-lg, p-4, flex, gap-2).

Theme colors available as Tailwind classes: background, foreground, card, card-foreground, primary, primary-foreground, secondary, secondary-foreground, muted, muted-foreground, border, input, ring, destructive, destructive-foreground. Example: className="bg-card text-card-foreground rounded-lg border p-4".

Pre-built shadcn/ui components (use these instead of native HTML elements):
- Button: variant="primary"|"secondary"|"destructive"|"outline"|"ghost", size="sm"|"md"|"lg"|"icon"
- Card: rounded-lg border container
- Badge: variant="default"|"secondary"|"outline"
- Input: styled text input (use instead of raw <input>)
- Textarea: styled multiline input (use instead of raw <textarea>)
- Select: styled select dropdown (use instead of raw <select>)
- Label: form label with proper styling
- Switch: toggle switch (checked, onCheckedChange)
- Separator: horizontal/vertical divider (orientation="horizontal"|"vertical")

IMPORTANT: Always use these components instead of native HTML form elements. Native elements will have basic styling but the components match the app's design system.

React 18 and hooks (useState, useEffect, useRef, useCallback, useMemo, useReducer, useContext, createContext) are available as globals — do NOT import them. Export your root component as default or name it App.`,
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
