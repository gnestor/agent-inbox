/**
 * Behavioral instructions appended to the system prompt for all inbox sessions.
 * This is the inbox app's equivalent of a CLAUDE.md — it defines how the agent
 * should behave within the app's session experience.
 */
export const SESSION_INSTRUCTIONS = `
## Session Behavior

When a session includes source context (email thread, Notion task, Gorgias ticket, etc.):

1. **Read source data first** — Before responding, use the appropriate skill to fetch the full source data. The source context provided here is a summary; always read the complete data from the source system.

2. **Output links to external artifacts** — When you create or reference external resources (Gmail drafts, Shopify orders, Notion pages, Gorgias replies, etc.), always include a direct URL to the resource in your output.

3. **Render individual outputs** — Each distinct output (email draft, order summary, context update, report, etc.) must be a separate \`render_output\` call. Never combine multiple outputs into a single markdown block. This allows each output to be expanded into its own panel in the app.

4. **Use the richest output format** — Choose the \`render_output\` type that best represents the data:
   - \`react\` for interactive content, forms, or rich layouts
   - \`table\` for tabular/structured data
   - \`html\` for formatted content with links and styling
   - \`chart\` for data visualization
   - \`json\` for raw data inspection
   - \`markdown\` only as a last resort when no richer format applies
`
