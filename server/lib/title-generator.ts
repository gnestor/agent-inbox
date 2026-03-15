const TITLE_SYSTEM_PROMPT = `You generate short titles for AI assistant sessions. Given a transcript excerpt, produce a concise title (max 60 chars) that captures the main task. Rules:
- Use imperative or noun-phrase form ("Draft Q1 email", "Debug auth middleware", "Analyze sales data")
- No quotes, no prefix like "Title:", just the title text
- If the session covers multiple topics, title the primary one`

/**
 * Build the prompt for Haiku from session messages.
 * Takes first 3 user messages + last assistant message to stay under context limits.
 */
export function buildTitlePrompt(
  messages: Array<{ type: string; message: string }>
): string {
  const parsed = messages
    .filter((m) => m.type === "user" || m.type === "assistant")
    .map((m) => {
      try {
        const obj = JSON.parse(m.message)
        const content = typeof obj.content === "string"
          ? obj.content
          : Array.isArray(obj.content)
            ? obj.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join(" ")
            : ""
        return { role: obj.type || m.type, content: content.slice(0, 500) }
      } catch {
        return null
      }
    })
    .filter(Boolean) as Array<{ role: string; content: string }>

  // Take first 3 user messages and last assistant message
  const userMsgs = parsed.filter((m) => m.role === "user").slice(0, 3)
  const lastAssistant = parsed.filter((m) => m.role === "assistant").pop()

  const parts = [
    ...userMsgs.map((m) => `User: ${m.content}`),
    ...(lastAssistant ? [`Assistant: ${lastAssistant.content}`] : []),
  ]

  return parts.join("\n\n")
}

/**
 * Parse Haiku's response into a clean title.
 */
export function parseTitleResponse(response: string): string | null {
  let title = response.trim()
  if (!title) return null

  // Strip surrounding quotes
  if ((title.startsWith('"') && title.endsWith('"')) ||
      (title.startsWith("'") && title.endsWith("'"))) {
    title = title.slice(1, -1)
  }

  // Strip common prefixes
  title = title.replace(/^(Title:\s*)/i, "")

  // Truncate to 60 chars
  if (title.length > 60) {
    title = title.slice(0, 57) + "..."
  }

  return title || null
}

/**
 * Generate a session title using Claude Haiku.
 * Returns the title string, or null if generation fails.
 */
export async function generateSessionTitle(
  messages: Array<{ type: string; message: string }>
): Promise<string | null> {
  const transcript = buildTitlePrompt(messages)
  if (!transcript) return null

  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default
    const client = new Anthropic() // uses ANTHROPIC_API_KEY from env

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 100,
      system: TITLE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: transcript }],
    })

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")

    return parseTitleResponse(text)
  } catch (err) {
    console.error("Title generation failed:", err)
    return null
  }
}
