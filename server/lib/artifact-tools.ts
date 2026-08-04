import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk"
import { z } from "zod"
import { ARTIFACT_CODE_GUIDANCE } from "@hammies/frontend/lib/artifact-guidance"

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
- .jsx → React component (Tailwind CSS, shadcn/ui, recharts, lucide-react available)
- .html → HTML page (JS/CSS inline in single file)
- .md → Markdown with syntax highlighting
- .svg → SVG image

For React (.jsx) — handle loading/error states with Skeleton and
Alert variant="destructive", and otherwise follow this contract exactly:

${ARTIFACT_CODE_GUIDANCE}

The root-element, typography, and globals rules above apply to .html artifacts too.
Colours: text-muted-foreground, hover:bg-secondary, bg-primary text-primary-foreground,
bg-accent text-accent-foreground. Spacing: p-4, gap-2 (default), gap-4 (sections).`,
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
