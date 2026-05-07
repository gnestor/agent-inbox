/**
 * Pre-curation deterministic skip gate.
 *
 * Cheap, code-only checks that decide whether an entity is worth dispatching
 * a Claude session for. Lives downstream of `extractEntities` (which already
 * filters bulk noise at extraction time) and upstream of `curateEntity`.
 *
 * Anything we skip here costs zero Claude tokens. Sources are still marked
 * processed so the queue moves forward.
 *
 * Three classes of skip:
 *
 *   1. **Opaque IDs** — values that look like account numbers, ticket refs,
 *      raw URLs. The agent has correctly skipped these in past runs (see
 *      LOG.md "Account #5015911", "ecom-cpa-llc"); we precompute the verdict.
 *
 *   2. **Personal email-provider domains** — `gmail.com`, `yahoo.com` etc.
 *      A `domain` entity for a personal provider is never the canonical home
 *      for a person. The matching `person:<email>` entry is the right unit.
 *
 *   3. **Self-references** — Hammies' own domains and the workspace owner.
 *      Already filtered at extraction by most plugins, but the discovered-
 *      entities loop can re-emit them.
 */

const OPAQUE_ID_PATTERNS: RegExp[] = [
  /^account\s*#\s*\d+$/i, // "Account #5015911"
  /^[a-zA-Z0-9_-]{20,}$/, // long opaque ID (Drive file IDs, hashes — mixed case)
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i, // UUID
  /^\d{6,}$/, // pure-numeric (5+ digits caught by isGenericFolder; 6+ catches more)
  /^[a-z]+:\/\//i, // raw URL
  /^#\d+$/, // ticket numbers like "#12345"
  // Gmail-generated message-IDs that gmail's reply-threading parser misreads
  // as email addresses. Local part is 30+ chars of base64-ish [a-zA-Z0-9_+]
  // ending at @mail.gmail.com. Real human Gmail addresses have local parts
  // <30 chars; these long ones are always parser artifacts.
  /^[a-zA-Z0-9_+]{30,}@(?:mail\.)?gmail\.com$/i,
]

const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "live.com",
  "msn.com",
  "comcast.net",
  "verizon.net",
  "att.net",
  "sbcglobal.net",
  "ymail.com",
  "rocketmail.com",
  "protonmail.com",
  "proton.me",
  "pm.me",
  "fastmail.com",
  "mail.com",
  "gmx.com",
  "gmx.net",
  "yandex.com",
  "yandex.ru",
  "qq.com",
  "163.com",
  "126.com",
  "optonline.net",
  "earthlink.net",
  "bellsouth.net",
  "cox.net",
  "charter.net",
  "cableone.net",
  "rogers.com",
  "shaw.ca",
  "telus.net",
  "btinternet.com",
  "ntlworld.com",
  "blueyonder.co.uk",
  "privaterelay.appleid.com",
])

/** Hammies' own identity. A `domain: hammies.com` entity isn't useful. */
const SELF_DOMAINS = new Set([
  "hammies.com",
  "hammiesshorts.com",
  "hammies.co",
])

/** Tag values that are never worth a curated page on their own. */
const TAG_NOISE_PREFIXES = ["category_", "smartlead/", "smartlead_", "auto-"]

export interface SkipDecision {
  skip: true
  reason: string
}

export interface ProceedDecision {
  skip: false
}

export type GateDecision = SkipDecision | ProceedDecision

/**
 * Deterministic verdict on whether to dispatch a Claude session for this
 * entity. Returning `skip:true` means: mark the queued sources processed and
 * move on, no LLM call needed.
 */
export function gateEntity(
  entityType: string,
  entityValue: string,
): GateDecision {
  const value = entityValue.trim()
  if (!value) return { skip: true, reason: "empty entity value" }

  // Personal email domain → never the canonical entity
  if (entityType === "domain") {
    const lower = value.toLowerCase()
    if (PERSONAL_EMAIL_DOMAINS.has(lower)) {
      return { skip: true, reason: `personal-email-provider domain (${lower})` }
    }
    if (SELF_DOMAINS.has(lower)) {
      return { skip: true, reason: `self domain (${lower})` }
    }
  }

  // Opaque IDs (any type)
  for (const pattern of OPAQUE_ID_PATTERNS) {
    if (pattern.test(value)) {
      return { skip: true, reason: `opaque-id pattern (${pattern.source})` }
    }
  }

  // Tag noise prefixes
  if (entityType === "tag") {
    const lower = value.toLowerCase()
    for (const prefix of TAG_NOISE_PREFIXES) {
      if (lower.startsWith(prefix)) {
        return { skip: true, reason: `noise tag prefix (${prefix})` }
      }
    }
  }

  // Single-character / very short values
  if (value.length < 2) {
    return { skip: true, reason: "value too short" }
  }

  // Person values that are non-email + single token (one word, no whitespace).
  // These are typically Gorgias `customerName` first-only fragments ("wes",
  // "doug", "kristin") or chat-handle-style truncations. Real curatable
  // people have either an email address OR a multi-word name. Single tokens
  // produce thin pages with no resolvable identity.
  if (entityType === "person" && !value.includes("@") && !/\s/.test(value)) {
    return { skip: true, reason: `single-token person name (${value})` }
  }

  return { skip: false }
}

export const __test__ = {
  PERSONAL_EMAIL_DOMAINS,
  SELF_DOMAINS,
  OPAQUE_ID_PATTERNS,
}
