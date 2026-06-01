import { describe, expect, test, vi, beforeEach } from "vitest"
import { candidatePageSlugs } from "../entity-curator.js"

// --- Mocks for curateEntity orchestration (MIN_SOURCES_BY_TYPE path) ---

const mockUnprocessed = vi.fn<(...a: unknown[]) => Promise<string[]>>()
const mockMarkProcessed = vi.fn(async () => {})
const mockRunCuration = vi.fn(async () => ({ ok: true as const }))

vi.mock("../entity-extractor.js", () => ({
  canonicalize: (_t: string, v: string) => v,
  topUnprocessedEntities: vi.fn(async () => []),
  unprocessedSourcesForEntity: (...a: unknown[]) => mockUnprocessed(...a),
  markProcessed: (...a: unknown[]) => mockMarkProcessed(...(a as [])),
  insertDiscoveredEntities: vi.fn(async () => {}),
  rollupPersonsToDomains: vi.fn(async () => {}),
}))

vi.mock("../curation-session.js", () => ({
  runBackgroundCurationSession: (...a: unknown[]) => mockRunCuration(...(a as [])),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe("curateEntity — MIN_SOURCES_BY_TYPE", () => {
  test("Scenario: Stage 4 — `MIN_SOURCES_BY_TYPE` skips low-yield entities — returns below-threshold skip without dispatching a session", async () => {
    // tag minimum is 5; supply only 2 unprocessed sources.
    mockUnprocessed.mockResolvedValue(["context/a.md", "context/b.md"])
    const { curateEntity } = await import("../entity-curator.js")
    const result = await curateEntity("/ws", "tag", "wholesale", "agent")
    expect(result.skipped).toMatch(/below min-source threshold/)
    // Sources marked processed so the queue advances; no session dispatched.
    expect(mockMarkProcessed).toHaveBeenCalled()
    expect(mockRunCuration).not.toHaveBeenCalled()
  })

  test("Scenario: Stage 4 — entity curation dispatches one Claude session per entity — runs one background curation session and returns its sessionId", async () => {
    // tag minimum is 5; supply exactly 5 unprocessed sources so it dispatches.
    // tag is not person/domain/company, so the engagement gate is bypassed and
    // no candidate page exists (readFile throws ENOENT → candidatePath null).
    mockUnprocessed.mockResolvedValue([
      "context/a.md",
      "context/b.md",
      "context/c.md",
      "context/d.md",
      "context/e.md",
    ])
    mockRunCuration.mockResolvedValue({ sessionId: "sess-xyz" } as never)

    const { curateEntity } = await import("../entity-curator.js")
    const result = await curateEntity("/ws", "tag", "wholesale", "agent")

    // Exactly one curation session dispatched for the entity.
    expect(mockRunCuration).toHaveBeenCalledTimes(1)
    expect("sessionId" in result && result.sessionId).toBe("sess-xyz")
    // Sources are NOT marked processed up-front — that happens in onComplete.
    expect(mockMarkProcessed).not.toHaveBeenCalled()
  })
})

describe("candidatePageSlugs", () => {
  test("domain: returns both dotted-form and brand-form (TLD-stripped)", () => {
    expect(candidatePageSlugs("domain", "gusto.com")).toEqual(["gusto-com", "gusto"])
    expect(candidatePageSlugs("domain", "mhomovement.com")).toEqual(["mhomovement-com", "mhomovement"])
    expect(candidatePageSlugs("domain", "the-sourcing-company.net")).toEqual([
      "the-sourcing-company-net",
      "the-sourcing-company",
    ])
  })

  test("domain: handles double-TLD (.com.au, .co.uk)", () => {
    // Brand slug strips both segments — `intas-com-au` -> `intas`
    const slugs = candidatePageSlugs("domain", "intas.com.au")
    expect(slugs[0]).toBe("intas-com-au")
    expect(slugs).toContain("intas")
  })

  test("domain: brand slug omitted when identical to dotted slug", () => {
    // Single-segment hypothetical: same string both ways → only one entry
    expect(candidatePageSlugs("domain", "shopify")).toEqual(["shopify"])
  })

  test("person with email: only one slug, no domain fallback", () => {
    // Person pages must NOT short-circuit to a domain page via the candidate
    // lookup — that path is handled by findParentCompanyPage with explicit
    // company-merge prompt steering.
    expect(candidatePageSlugs("person", "kurt@incip.com")).toEqual(["kurt-incip-com"])
  })

  test("company / project: single slug", () => {
    expect(candidatePageSlugs("company", "The Sourcing Company")).toEqual(["the-sourcing-company"])
    expect(candidatePageSlugs("project", "Nordstrom Marketplace")).toEqual(["nordstrom-marketplace"])
  })

  test("folder: single slug", () => {
    expect(candidatePageSlugs("folder", "Pacifica 2019")).toEqual(["pacifica-2019"])
  })
})
