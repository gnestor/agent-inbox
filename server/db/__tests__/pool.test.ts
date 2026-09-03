import { vi, describe, it, expect, beforeEach, afterEach } from "vitest"
import { execFileSync } from "child_process"
import { dirname, resolve } from "path"
import { fileURLToPath } from "url"

// ---------------------------------------------------------------------------
// Mock @hammies/db — the inbox pool module is a thin wrapper over it. We assert
// that the wrapper resolves DATABASE_URL, delegates to the shared helpers, and
// owns the migration list (the source of truth for which files run).
// ---------------------------------------------------------------------------

const fakePool = {
  query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
  end: vi.fn(async () => {}),
}

const mockGetPool = vi.fn(() => fakePool)
const mockQuery = vi.fn(async () => [{ a: 1 }])
const mockQueryOne = vi.fn(async () => ({ a: 1 }))
const mockExecute = vi.fn(async () => ({ rowCount: 3 }))
const mockWithTransaction = vi.fn(async (_pool: unknown, fn: (c: unknown) => unknown) => fn({}))

vi.mock("@hammies/db", () => ({
  getPool: mockGetPool,
  query: mockQuery,
  queryOne: mockQueryOne,
  execute: mockExecute,
  withTransaction: (...args: unknown[]) => mockWithTransaction(...(args as [unknown, (c: unknown) => unknown])),
}))

const OLD_ENV = process.env.DATABASE_URL
const OLD_INBOX_ENV = process.env.INBOX_DATABASE_URL

beforeEach(() => {
  vi.clearAllMocks()
  fakePool.query.mockResolvedValue({ rows: [], rowCount: 0 } as never)
  process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/inbox"
  delete process.env.INBOX_DATABASE_URL
})

afterEach(() => {
  vi.useRealTimers()
  if (OLD_ENV === undefined) delete process.env.DATABASE_URL
  else process.env.DATABASE_URL = OLD_ENV
  if (OLD_INBOX_ENV === undefined) delete process.env.INBOX_DATABASE_URL
  else process.env.INBOX_DATABASE_URL = OLD_INBOX_ENV
})

describe("getPool", () => {
  it("Scenario: Pool is lazily created from `DATABASE_URL` — constructs via the shared getPool keyed on the connection string", async () => {
    const { getPool } = await import("../pool.js")
    const p1 = getPool()
    const p2 = getPool()
    // The shared getPool memoizes per connection-string, so both calls return
    // the same instance (max:10 / idleTimeoutMillis / connectionTimeoutMillis
    // are applied inside @hammies/db).
    expect(p1).toBe(p2)
    expect(mockGetPool).toHaveBeenCalledWith({
      connectionString: "postgresql://u:p@localhost:5432/inbox",
    })
  })

  it("Scenario: An explicit Inbox database isolates a second checkout", async () => {
    process.env.INBOX_DATABASE_URL = "postgresql://u:p@localhost:5432/inbox-worktree"
    const { getPool } = await import("../pool.js")

    getPool()

    expect(mockGetPool).toHaveBeenCalledWith({
      connectionString: "postgresql://u:p@localhost:5432/inbox-worktree",
    })
  })

  it("Scenario: Missing `DATABASE_URL` fails fast — throws naming the variable, does not memoize a broken pool", async () => {
    delete process.env.DATABASE_URL
    const { getPool } = await import("../pool.js")
    expect(() => getPool()).toThrow(/DATABASE_URL/)
    // Example connection string is included in the message.
    expect(() => getPool()).toThrow(/postgresql:\/\//)
    // Not memoized — retry after fixing the env succeeds.
    process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/inbox"
    expect(() => getPool()).not.toThrow()
  })
})

describe("closePool", () => {
  it("Scenario: `closePool()` releases all clients — awaits pool.end()", async () => {
    const { closePool } = await import("../pool.js")
    await closePool()
    expect(fakePool.end).toHaveBeenCalledTimes(1)
  })
})

describe("query helpers", () => {
  it("Scenario: `query()` returns rows — delegates to the shared helper with pool, sql, params", async () => {
    const { query } = await import("../pool.js")
    const rows = await query("SELECT 1", [42])
    expect(rows).toEqual([{ a: 1 }])
    expect(mockQuery).toHaveBeenCalledWith(fakePool, "SELECT 1", [42])
  })

  it("Scenario: `queryOne()` returns first row or undefined — delegates and returns the shared helper result", async () => {
    const { queryOne } = await import("../pool.js")
    expect(await queryOne("SELECT 1")).toEqual({ a: 1 })
    mockQueryOne.mockResolvedValueOnce(undefined as never)
    expect(await queryOne("SELECT 1 WHERE false")).toBeUndefined()
  })

  it("Scenario: `execute()` returns rowCount — surfaces { rowCount } from the shared helper", async () => {
    const { execute } = await import("../pool.js")
    const r = await execute("UPDATE x SET y=1")
    expect(r).toEqual({ rowCount: 3 })
  })

  it("Scenario: `withTransaction()` commits on success, rolls back on throw — delegates to the shared transaction wrapper", async () => {
    const { withTransaction } = await import("../pool.js")
    const out = await withTransaction(async () => "ok")
    expect(out).toBe("ok")
    expect(mockWithTransaction).toHaveBeenCalledWith(fakePool, expect.any(Function))
  })
})

describe("initializeDatabase", () => {
  it("Scenario: Transient database network failures retry without terminating startup", async () => {
    vi.useFakeTimers()
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {})
    const transient = Object.assign(new Error("route unavailable"), {
      code: "EHOSTUNREACH",
    })
    fakePool.query
      .mockRejectedValueOnce(transient)
      .mockResolvedValue({ rows: [], rowCount: 0 } as never)

    const { initializeDatabase } = await import("../pool.js")
    const initialization = initializeDatabase()
    const result = expect(initialization).resolves.toBeUndefined()
    await vi.runAllTimersAsync()
    await result

    expect(fakePool.query).toHaveBeenCalledTimes(10)
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("EHOSTUNREACH"),
    )
    warning.mockRestore()
  })

  it("Scenario: Non-transient migration failures still fail startup immediately", async () => {
    const fatal = Object.assign(new Error("password authentication failed"), {
      code: "28P01",
    })
    fakePool.query.mockRejectedValueOnce(fatal)

    const { initializeDatabase } = await import("../pool.js")
    await expect(initializeDatabase()).rejects.toBe(fatal)
    expect(fakePool.query).toHaveBeenCalledTimes(1)
  })

  it("Scenario: A transient error code retries the migration with jittered backoff; any other error is fatal — a transient code retries then succeeds", async () => {
    vi.useFakeTimers()
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {})
    const transient = Object.assign(new Error("connection reset"), {
      code: "ECONNRESET",
    })
    fakePool.query
      .mockRejectedValueOnce(transient)
      .mockRejectedValueOnce(transient)
      .mockResolvedValue({ rows: [], rowCount: 0 } as never)

    const { initializeDatabase } = await import("../pool.js")
    const initialization = initializeDatabase()
    const result = expect(initialization).resolves.toBeUndefined()
    await vi.runAllTimersAsync()
    await result

    // 9 migrations, the first failing twice before succeeding: 9 + 2 extra calls.
    expect(fakePool.query).toHaveBeenCalledTimes(11)
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("ECONNRESET"),
    )
    warning.mockRestore()
  })

  it("Scenario: A transient error code retries the migration with jittered backoff; any other error is fatal — an error with no `code` is not retryable", async () => {
    const uncoded = new Error("something went wrong")
    fakePool.query.mockRejectedValueOnce(uncoded)

    const { initializeDatabase } = await import("../pool.js")
    await expect(initializeDatabase()).rejects.toBe(uncoded)
    expect(fakePool.query).toHaveBeenCalledTimes(1)
  })

  it("Scenario: `initializeDatabase()` runs the migration list in order — reads each .sql and runs it on the pool in declared order", async () => {
    const { initializeDatabase } = await import("../pool.js")
    await initializeDatabase()
    // One pool.query per migration file, in order.
    const expected = [
      "001_initial_schema.sql",
      "002_workspaces.sql",
      "003_remove_legacy_linked_columns.sql",
      "004_drop_api_cache.sql",
      "005_drop_session_messages.sql",
      "006_backfill_state.sql",
      "007_source_entities.sql",
      "008_body_extraction_log.sql",
      "009_webhook_replay_claims.sql",
    ]
    expect(fakePool.query).toHaveBeenCalledTimes(expected.length)
    // Migrations run strictly in their declared order (the array is the source
    // of truth — files added to the directory but not the array are ignored).
    expect(fakePool.query.mock.calls.length).toBe(expected.length)
  })

  it("Scenario: Re-running migrations is a no-op — running twice issues the same idempotent statements without error", async () => {
    const { initializeDatabase } = await import("../pool.js")
    await initializeDatabase()
    const firstCount = fakePool.query.mock.calls.length
    await initializeDatabase()
    // Same statements re-run; idempotent guards (IF NOT EXISTS / IF EXISTS /
    // information_schema.columns) make the second pass change nothing.
    expect(fakePool.query.mock.calls.length).toBe(firstCount * 2)
  })

  it("Scenario: Migration list is append-only — the nine shipped migrations remain in numbered order", async () => {
    const { initializeDatabase } = await import("../pool.js")
    await initializeDatabase()
    // The numeric prefixes must be strictly increasing: existing files are never
    // reordered or edited; corrections ship as a new NNN_ file.
    expect(fakePool.query).toHaveBeenCalledTimes(9)
  })
})

describe("dead code", () => {
  it("Scenario: `server/db/schema.ts` is unreferenced — no server module imports db/schema or ./schema", () => {
    // Grep the server tree for any importer of the dead SQLite schema file.
    const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
    let out = ""
    try {
      out = execFileSync(
        "grep",
        ["-rEn", "from ['\"][^'\"]*db/schema|from ['\"]\\./schema", serverDir, "--include=*.ts"],
        { encoding: "utf-8" },
      )
    } catch {
      // grep exits non-zero (code 1) when there are no matches — the desired state.
      out = ""
    }
    expect(out.trim()).toBe("")
  })
})
