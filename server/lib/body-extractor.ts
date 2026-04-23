/**
 * Body-text entity extraction via a local LLM (Ollama).
 *
 * Plugins' `extractEntities` only surface structured metadata (email
 * addresses, assignees, folder names). Body extraction fills the gap by
 * reading source bodies and pulling out named people, companies, products,
 * and projects that never appear in headers. Runs as a bulk async pass,
 * independent of raw backfill.
 *
 * Configuration (env vars):
 *   OLLAMA_HOST   — default http://localhost:11434
 *   OLLAMA_MODEL  — default qwen3.5:9b
 */

import { readFile } from "fs/promises"
import { createLogger } from "./logger.js"
import { canonicalize } from "./entity-extractor.js"
import type { Entity } from "../../src/types/plugin.js"

const log = createLogger("body-extractor")

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434"
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3.5:9b"

// Truncate source bodies before sending to the model. Entities typically
// surface in the first paragraphs; beyond ~8KB the token cost isn't worth
// the marginal recall.
const MAX_CONTENT_CHARS = 8000

const SYSTEM_PROMPT = `You extract entities from business source documents for a relationship-indexing system. Output strict JSON only — no prose, no markdown fences.`

const USER_PROMPT_TEMPLATE = (content: string) => `Extract distinct entities mentioned in the document below.

Entity types to capture:
- "person": named individuals (first + last name, or email address). Skip roles like "customer", "the team", "shipper".
- "company": organizations, vendors, retailers, platforms (not generic words like "the factory").
- "product": specific product names or SKUs.
- "project": named initiatives, POs (e.g. "PO-43"), campaigns.

Rules:
- Only include entities that have a concrete, specific identity visible in the text.
- Skip the workspace owner "Grant Nestor" (and any grant@hammies.com address).
- Skip ubiquitous platforms already obvious from context (Shopify, Gmail, etc) unless the text is specifically about them.
- Names should be returned in their natural form (e.g. "Caroline Tuerk", "Wuxi Hende Textile Co Ltd").

Output format (JSON only):
{"entities": [{"type": "person", "value": "Caroline Tuerk"}, {"type": "company", "value": "Wuxi Hende"}]}

If no entities are found, return {"entities": []}.

Document:
---
${content}
---`

interface OllamaChatResponse {
  message?: { content?: string }
  done?: boolean
  error?: string
}

/**
 * Call Ollama's /api/chat endpoint with the extraction prompt.
 * Uses `format: "json"` to constrain output. Returns null on any error.
 */
async function callOllama(content: string): Promise<string | null> {
  const body = {
    model: OLLAMA_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: USER_PROMPT_TEMPLATE(content) },
    ],
    stream: false,
    format: "json",
    options: { num_predict: 512, temperature: 0 },
  }
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      log.warn("Ollama HTTP error", { status: res.status })
      return null
    }
    const data = (await res.json()) as OllamaChatResponse
    if (data.error) {
      log.warn("Ollama error", { error: data.error })
      return null
    }
    return data.message?.content ?? null
  } catch (err) {
    log.warn("Ollama call failed", { error: err instanceof Error ? err.message : String(err) })
    return null
  }
}

/**
 * Parse the model's JSON output into a deduplicated, canonicalized list of
 * entities. Silently drops malformed output.
 */
export function parseModelOutput(raw: string | null): Entity[] {
  if (!raw) return []
  let parsed: unknown
  try { parsed = JSON.parse(raw) }
  catch { return [] }

  const list = (parsed as { entities?: unknown }).entities
  if (!Array.isArray(list)) return []

  const seen = new Set<string>()
  const out: Entity[] = []
  for (const item of list) {
    if (!item || typeof item !== "object") continue
    const rec = item as { type?: unknown; value?: unknown }
    if (typeof rec.type !== "string" || typeof rec.value !== "string") continue
    const value = canonicalize(rec.type, rec.value)
    if (!value) continue
    const key = `${rec.type}|${value}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ type: rec.type, value })
  }
  return out
}

export async function extractBodyEntities(content: string): Promise<Entity[]> {
  const trimmed = content.length > MAX_CONTENT_CHARS
    ? content.slice(0, MAX_CONTENT_CHARS)
    : content
  const raw = await callOllama(trimmed)
  return parseModelOutput(raw)
}

/**
 * Convenience: read a stub file and extract entities from its body.
 */
export async function extractBodyEntitiesFromFile(absPath: string): Promise<Entity[]> {
  let content: string
  try {
    content = await readFile(absPath, "utf8")
  } catch {
    return []
  }
  return extractBodyEntities(content)
}
