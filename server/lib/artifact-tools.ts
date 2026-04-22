import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk"
import { z } from "zod"

/**
 * Builds an in-process MCP server with `create_file` and `present_files` tools.
 *
 * These tools match Claude.ai's artifact interface, leveraging the model's
 * built-in training for when/how to create artifacts. The agent writes a file
 * with `create_file`, then calls `present_files` to display it.
 *
 * The frontend detects `present_files` tool_use blocks in the transcript and
 * renders the content from the corresponding `create_file` block based on
 * file extension (.jsx → React, .html → iframe, .md → Markdown, etc.).
 */
export function buildArtifactMcpServer() {
  const createFileTool = tool(
    "create_file",
    `Create a file that renders in the UI. After creating, call present_files to display it.

Supported renderable extensions:
- .jsx → React component (Tailwind CSS, shadcn/ui, recharts, lucide-react, d3, lodash available)
- .html → HTML page (JS/CSS inline in single file)
- .md → Markdown with syntax highlighting
- .svg → SVG image

For React (.jsx):
- Use Tailwind utility classes for all styling
- Import components from '@hammies/frontend/components/ui': Button, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Badge, Input, Textarea, Label, Select, SelectTrigger, SelectValue, SelectContent, SelectItem, Separator, Switch, Checkbox, Tabs, TabsList, TabsTrigger, TabsContent, Table, TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell, TableCaption, Skeleton, Progress, Avatar, AvatarImage, AvatarFallback, Accordion, AccordionItem, AccordionTrigger, AccordionContent, Alert, AlertTitle, AlertDescription, Toggle, ToggleGroup, ToggleGroupItem, RadioGroup, RadioGroupItem, Spinner
- Import 'cn' from '@hammies/frontend/lib/utils' ONLY. It is also re-exported from '@hammies/frontend/components/ui' but importing from both paths produces a duplicate-identifier compile error.
- Import hooks from 'react': useState, useEffect, useRef, useCallback, useMemo
- Import charts from 'recharts': LineChart, BarChart, AreaChart, PieChart, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Line, Bar, Area, Pie, Cell, ResponsiveContainer
- Import icons from 'lucide-react': any icon e.g. Search, Mail, Check, X, ChevronRight, etc.
- Import from 'd3' or 'lodash' as needed
- Export default your root component (or name it App)
- NEVER use localStorage or sessionStorage — use React state instead

CRITICAL STYLE RULES:
- Root element: NO bg-background, bg-card, text-foreground, or padding. The app provides these.
- Typography: text-sm font-semibold (headings), text-xs text-muted-foreground (secondary). Never text-base or text-lg.
- Colors: text-muted-foreground, hover:bg-secondary, bg-primary text-primary-foreground, bg-accent text-accent-foreground
- Spacing: p-4, gap-2 (default), gap-4 (sections)

GLOBALS (do not import):
- sendAction(intent, data?) — Send action to the agent. Agent receives: <artifact_action intent="...">data</artifact_action>
- saveState(state) — Persist UI state across reloads. Restored via window.__onStateRestored.`,
    {
      description: z.string().describe("Why you are creating this file"),
      path: z.string().describe("File path — use /mnt/user-data/outputs/<name>.<ext>"),
      file_text: z.string().describe("File content"),
    },
    async (args) => {
      const ext = args.path.split(".").pop()?.toLowerCase() ?? ""
      const size = args.file_text.length
      return {
        content: [{
          type: "text" as const,
          text: `File created: ${args.path} (${size} chars, .${ext})`,
        }],
      }
    }
  )

  const presentFilesTool = tool(
    "present_files",
    `Display created files in the UI. Call after create_file to render the artifact.
Accepts an array of file paths. Files render based on their extension (.jsx, .html, .md, .svg).
The first file is shown prominently.`,
    {
      filepaths: z.array(z.string()).min(1).describe("File paths to present (from create_file)"),
    },
    async (args) => {
      const paths = args.filepaths.join(", ")
      return {
        content: [{
          type: "text" as const,
          text: `Presenting: ${paths}`,
        }],
      }
    }
  )

  return createSdkMcpServer({
    name: "artifact",
    version: "1.0.0",
    tools: [createFileTool, presentFilesTool],
  })
}
