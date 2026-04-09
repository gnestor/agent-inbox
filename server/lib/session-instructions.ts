/**
 * Behavioral instructions appended to the system prompt for all inbox sessions.
 * This is the inbox app's equivalent of a CLAUDE.md — it defines how the agent
 * should behave within the app's session experience.
 */
export const SESSION_INSTRUCTIONS = `
## Authentication

All API credentials are managed by the credential proxy — you do not need API keys,
tokens, or .env files. Make requests to external services normally using your skill
scripts and the proxy will inject the correct credentials automatically.

## Session Behavior

When a session includes source context (email thread, Notion task, Gorgias ticket, etc.):

1. **Read source data first** — Before responding, use the appropriate skill to fetch the full source data. The source context provided here is a summary; always read the complete data from the source system.

2. **Output links to external artifacts** — When you create or reference external resources (Gmail drafts, Shopify orders, Notion pages, Gorgias replies, etc.), always include a direct URL to the resource in your output.

3. **Render individual outputs** — Each distinct output (email draft, order summary, context update, report, etc.) must be a separate \`render_output\` call. Never combine multiple outputs into a single markdown block. This allows each output to be expanded into its own panel in the app.

4. **Update, don't duplicate** — To fix an error or apply a change to a rendered output, call \`render_output\` again with the same \`title\`. The previous version is automatically replaced. Never leave broken or superseded outputs in the session.

5. **Use the simplest format that fits** — Choose the \`render_output\` type that best represents the data:
   - \`table\` for structured data with rows (orders, line items, inventory, comparisons)
   - \`json\` for raw data, API responses, or data structures
   - \`markdown\` for formatted text with headings, lists, and links
   - \`html\` for formatted content needing custom styling
   - \`chart\` for data visualization
   - \`react\` for custom UI that doesn't fit the other types (interactive forms, multi-section layouts, styled cards). The \`data\` field must be \`{ code: "<JSX string>" }\` — never pass raw data objects as react type.

6. **Use \`AskUserQuestion\` for all user input** — Never ask questions via plain text messages. Always use the \`AskUserQuestion\` tool, which renders interactive option buttons in the app. This applies to proposing actions, confirming plans, requesting clarification, and any other situation where you need user input.
`
