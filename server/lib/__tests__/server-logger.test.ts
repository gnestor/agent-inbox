import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

// The server logger lives in the shared frontend package
// (`@hammies/frontend/lib/serverLogger`) but is wired into every inbox server
// module. `IS_PROD` and `MIN_LEVEL` are captured at module-load time, so each
// scenario sets the relevant env var BEFORE a cache-busted dynamic import to
// observe the corresponding behaviour.

const MODULE = "@hammies/frontend/lib/serverLogger"

let bustCounter = 0
async function loadLogger(bust: string) {
  bustCounter += 1
  return import(/* @vite-ignore */ `${MODULE}?${bust}=${bustCounter}`)
}

function lastArg(spy: { mock: { calls: unknown[][] } }): string {
  const calls = spy.mock.calls
  return calls[calls.length - 1]?.[0] as string
}

describe("server structured logger", () => {
  let origNodeEnv: string | undefined
  let origLogLevel: string | undefined
  let stdout: ReturnType<typeof vi.spyOn>
  let stderr: ReturnType<typeof vi.spyOn>
  let logSpy: ReturnType<typeof vi.spyOn>
  let warnSpy: ReturnType<typeof vi.spyOn>
  let debugSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    origNodeEnv = process.env.NODE_ENV
    origLogLevel = process.env.LOG_LEVEL
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
    stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {})
  })

  afterEach(() => {
    if (origNodeEnv !== undefined) process.env.NODE_ENV = origNodeEnv
    else delete process.env.NODE_ENV
    if (origLogLevel !== undefined) process.env.LOG_LEVEL = origLogLevel
    else delete process.env.LOG_LEVEL
    vi.restoreAllMocks()
  })

  it("Scenario: Production emits JSON lines — one JSON object per line, errors to stderr", async () => {
    process.env.NODE_ENV = "production"
    delete process.env.LOG_LEVEL
    const { createLogger } = await loadLogger("prod")
    const log = createLogger("session")

    log.info("Session started", { sessionId: "xyz" })
    const infoLine = lastArg(stdout)
    const parsed = JSON.parse(infoLine.trim()) as Record<string, unknown>
    expect(parsed).toMatchObject({ level: "info", module: "session", msg: "Session started", sessionId: "xyz" })
    expect(parsed.ts).toBeTypeOf("string")

    log.error("boom")
    const errLine = lastArg(stderr)
    expect(JSON.parse(errLine.trim())).toMatchObject({ level: "error", module: "session" })
  })

  it("Scenario: Development emits human-readable lines — `[LEVEL] [module]` with req tag only inside a context", async () => {
    process.env.NODE_ENV = "development"
    delete process.env.LOG_LEVEL
    const { createLogger, runWithRequestContext } = await loadLogger("dev")
    const log = createLogger("session")

    log.info("no ctx")
    const plain = lastArg(logSpy)
    expect(plain).toContain("[INFO] [session] no ctx")
    expect(plain).not.toContain("req=")

    runWithRequestContext({ requestId: "abcdef0123456789" }, () => {
      log.info("with ctx", { k: "v" })
    })
    const tagged = lastArg(logSpy)
    expect(tagged).toContain("[INFO] [session] req=abcdef01")
    expect(tagged).toContain("k=v")
  })

  it("Scenario: `runWithRequestContext` injects requestId on every nested log — including async descendants; call-site wins on collision", async () => {
    process.env.NODE_ENV = "production"
    delete process.env.LOG_LEVEL
    const { createLogger, runWithRequestContext } = await loadLogger("ctx")
    const log = createLogger("mod")

    await runWithRequestContext({ requestId: "req-123", userEmail: "a@test.com" }, async () => {
      await Promise.resolve()
      log.info("nested")
    })
    const line = JSON.parse(lastArg(stdout).trim()) as Record<string, unknown>
    expect(line.requestId).toBe("req-123")
    expect(line.userEmail).toBe("a@test.com")

    // Call-site context wins over auto-injected fields when keys collide.
    runWithRequestContext({ requestId: "auto" }, () => {
      log.info("override", { requestId: "explicit" })
    })
    const overridden = JSON.parse(lastArg(stdout).trim()) as Record<string, unknown>
    expect(overridden.requestId).toBe("explicit")
  })

  it("Scenario: `LOG_LEVEL` filters output — debug/info dropped, warn/error pass when LOG_LEVEL=warn", async () => {
    process.env.NODE_ENV = "development"
    process.env.LOG_LEVEL = "warn"
    const { createLogger } = await loadLogger("level")
    const log = createLogger("mod")

    log.debug("d")
    log.info("i")
    expect(debugSpy).not.toHaveBeenCalled()
    expect(logSpy).not.toHaveBeenCalled()

    log.warn("w")
    expect(warnSpy).toHaveBeenCalled()
  })

  it("Scenario: `child(ctx)` adds default fields — child logger includes ctx without the caller passing it", async () => {
    process.env.NODE_ENV = "production"
    delete process.env.LOG_LEVEL
    const { createLogger } = await loadLogger("child")
    const log = createLogger("foo").child({ sessionId: "s1" })

    log.info("hi")
    const line = JSON.parse(lastArg(stdout).trim()) as Record<string, unknown>
    expect(line.sessionId).toBe("s1")
  })
})
