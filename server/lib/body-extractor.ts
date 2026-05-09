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

/**
 * Noise patterns applied to body-extracted entities. The model sometimes
 * returns generic terms or automated-sender artifacts despite prompt rules;
 * this is the last-chance filter before inserting into source_entities.
 */
const PROMO_SUBDOMAIN_RE = /^(em|e|mail|mailer|engage|news|newsletter|marketing|promo|bounces?|notifications?|updates|alerts|reply)\./i
const AUTOMATED_LOCAL_RE = /^(noreply|no-reply|donotreply|do-not-reply|notify|notifications?|updates|alerts|mailer|mailer-daemon|postmaster|auto-confirm|auto-reply|bounces?|reply|support)(@|[-_])/i
const NOISY_PERSON_NAMES = new Set([
  "grant nestor",
  "grant",
  "customer", "the customer", "team", "the team", "support", "support team",
  "sender", "recipient", "user", "admin", "administrator", "nobody",
])
const NOISY_COMPANY_NAMES = new Set([
  "hammies", "hammies shorts",                   // self
  "gmail", "google", "yahoo", "outlook", "hotmail",  // ubiquitous platforms
  "shopify", "stripe", "paypal", "venmo",
  "mailchimp", "klaviyo",
  "ups", "usps", "fedex", "shipbob", "shipmonk",
])

function isNoiseEntity(type: string, value: string): boolean {
  const v = value.trim().toLowerCase()
  if (!v) return true
  if (type === "person") {
    if (NOISY_PERSON_NAMES.has(v)) return true
    if (v.includes("@")) {
      if (AUTOMATED_LOCAL_RE.test(v)) return true
      const domain = v.split("@")[1]
      if (domain && PROMO_SUBDOMAIN_RE.test(domain)) return true
    }
  }
  if (type === "company") {
    if (NOISY_COMPANY_NAMES.has(v)) return true
  }
  if (type === "domain") {
    if (PROMO_SUBDOMAIN_RE.test(v)) return true
  }
  return false
}

const log = createLogger("body-extractor")

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434"
// Default to the smaller 4B model; override via env.
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3.5:4b"

// Truncate source bodies before sending to the model. Entities typically
// surface in the first paragraphs; beyond ~8KB the token cost isn't worth
// the marginal recall.
const MAX_CONTENT_CHARS = 8000

const SYSTEM_PROMPT = `You extract entities from business source documents for a relationship-indexing system. Output strict JSON only — no prose, no markdown fences.`

// GEPA-optimized instructions (see packages/optimizer/artifacts/body_extract_optimized.json).
// Shadow run on 50-example holdout: judge score 75.97 → 83.56 (+7.59pp), all four
// rubric criteria improved by 6+pp with no regressions. Merge gate passed.
const USER_PROMPT_TEMPLATE = (content: string) => `Extract distinct entities mentioned in the document below.

Entity types to capture:
- "person": named individuals (first + last name, or email address). Skip
  roles like "customer", "the team", "shipper", or first names only (e.g., "Sarah").
- "company": organizations, vendors, retailers, platforms, service providers
  (not generic words like "the factory"). Include business domains/websites
  when they appear as distinct identifiers (e.g., "jeffsheltonarchitect.com").
- "product": specific product names or SKUs with concrete identity. Exclude
  generic product descriptions (e.g., "Hammies shorts" is too generic; only
  extract if a specific product line or variant is named).
- "project": named initiatives, POs (e.g., "PO-43"), campaigns, or photo shoots
  with concrete names (e.g., "Smock shoot"). Do NOT include order numbers
  (e.g., "Order#2734") as projects unless they represent named initiatives
  or campaigns—order numbers are transactions, not projects.

Rules:
- Only include entities with a concrete, specific identity visible in the text.
- Skip the workspace owner "Grant Nestor" and any grant@hammies.com or
  grant@hammiesshorts.com address. Do not include other Hammies-affiliated
  email addresses unless the person has an independent identity (e.g., separate
  company affiliation).
- Skip ubiquitous platforms already obvious from context (Shopify, Gmail,
  Notion, Google Docs, Shortwave, etc.) unless the text is specifically about
  them or they appear as part of a distinct business identity.
- Do not extract venue names (e.g., "El Jardin", "El Zapato") as companies
  unless they are explicitly presented as business entities with owners/contacts.
- Apply strict noise filtering: exclude key participants who are primarily
  service contacts or customers in routine business correspondence. Include
  only entities that represent independent business relationships or third-party
  stakeholders with distinct relevance to the document's core purpose. Prioritize
  business partners, vendors, and collaborators over transactional customers
  or routine service providers.
- Exclude generic company references that are primarily context (e.g.,
  "Hammies Short" when mentioned only as Grant Nestor's employer in a customer
  service email thread).
- Do not extract brands/products that a person represents or sells as separate
  company entities unless they are central to the document's purpose. For
  example, if someone lists multiple brands in their signature, extract only
  the one(s) that are the focus of the conversation plus their primary company
  affiliation, not every brand in the portfolio.
- Names returned in their natural form (e.g., "Caroline Tuerk", "Wuxi Hende").
- Prefer full names (first + last) over partial names; only extract single
  first names if they are the only identifier available for a key participant.
- Normalize company name capitalization and formatting to standard business
  conventions (e.g., "Retail Reworks" not "RETAIL REWORKS").
- When extracting companies from email domains or brand names, attempt to
  infer and use the full, formal company name rather than abbreviations
  (e.g., "smplbrnd.com" → "SMPL Brand"; "screamingmimis.com" → "Screaming
  Mimis"). If the formal name cannot be reliably inferred, use the most
  reasonable expansion of the domain abbreviation.
- When a product appears as a collaboration or partnership (e.g.,
  "Vacation(R) x Hammies"), extract both the product name AND the independent
  company partner (e.g., "Vacation Inc"). Do not treat the entire collaboration
  string as a single product entity.
- Customer names appearing in routine customer service contexts (e.g., ticket
  subjects, customer fields in support tickets) should generally be excluded
  unless they represent a business entity or stakeholder with independent
  relevance.
- Do not extract individuals mentioned only in passing or in cited/forwarded
  messages unless they are active participants in the core conversation or
  represent key business relationships.

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
 * Optional `model` override — defaults to OLLAMA_MODEL env var.
 */
async function callOllama(content: string, model?: string): Promise<string | null> {
  const body = {
    model: model ?? OLLAMA_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: USER_PROMPT_TEMPLATE(content) },
    ],
    stream: false,
    // Disable thinking for reasoning models (Qwen 3.5): without this, output
    // tokens are consumed by the private `thinking` field and `content` is empty.
    think: false,
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
    if (isNoiseEntity(rec.type, rec.value)) continue
    const value = canonicalize(rec.type, rec.value)
    if (!value) continue
    if (isNoiseEntity(rec.type, value)) continue
    const key = `${rec.type}|${value}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ type: rec.type, value })
  }
  return out
}

export async function extractBodyEntities(content: string, model?: string): Promise<Entity[]> {
  const trimmed = content.length > MAX_CONTENT_CHARS
    ? content.slice(0, MAX_CONTENT_CHARS)
    : content
  const raw = await callOllama(trimmed, model)
  return parseModelOutput(raw)
}

/**
 * Convenience: read a stub file and extract entities from its body.
 */
export async function extractBodyEntitiesFromFile(absPath: string, model?: string): Promise<Entity[]> {
  let content: string
  try {
    content = await readFile(absPath, "utf8")
  } catch {
    return []
  }
  return extractBodyEntities(content, model)
}
