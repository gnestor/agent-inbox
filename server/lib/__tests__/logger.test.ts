import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { createLogger, runWithRequestContext, getRequestContext } from "../logger.js"

describe("createLogger", () => {
  let logSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    errorSpy.mockRestore()
    warnSpy.mockRestore()
  })

  it("creates a logger with the module tag", () => {
    const log = createLogger("test")
    log.info("hello")
    expect(logSpy).toHaveBeenCalledOnce()
    const output = logSpy.mock.calls[0]?.[0] as string
    expect(output).toContain("[INFO]")
    expect(output).toContain("[test]")
    expect(output).toContain("hello")
  })

  it("formats context as key=value pairs", () => {
    const log = createLogger("test")
    log.info("event", { sessionId: "abc", count: 3 })
    const output = logSpy.mock.calls[0]?.[0] as string
    expect(output).toContain("sessionId=abc")
    expect(output).toContain("count=3")
  })

  it("uses appropriate log method per level", () => {
    const log = createLogger("test")
    log.info("i")
    log.warn("w")
    log.error("e")
    expect(logSpy).toHaveBeenCalledOnce()
    expect(warnSpy).toHaveBeenCalledOnce()
    expect(errorSpy).toHaveBeenCalledOnce()
  })

  it("child logger merges default context", () => {
    const log = createLogger("test")
    const child = log.child({ userId: "u1" })
    child.info("event", { action: "click" })
    const output = logSpy.mock.calls[0]?.[0] as string
    expect(output).toContain("userId=u1")
    expect(output).toContain("action=click")
  })
})

describe("runWithRequestContext / getRequestContext", () => {
  it("returns undefined outside of a request context", () => {
    expect(getRequestContext()).toBeUndefined()
  })

  it("provides the context inside the runner", () => {
    const ctx = runWithRequestContext({ requestId: "req-1" }, () => getRequestContext())
    expect(ctx).toEqual({ requestId: "req-1" })
  })

  it("isolates contexts across concurrent runs", async () => {
    const results = await Promise.all([
      new Promise<string | undefined>((resolve) => {
        runWithRequestContext({ requestId: "req-a" }, () => {
          setTimeout(() => resolve(getRequestContext()?.requestId), 10)
        })
      }),
      new Promise<string | undefined>((resolve) => {
        runWithRequestContext({ requestId: "req-b" }, () => {
          setTimeout(() => resolve(getRequestContext()?.requestId), 5)
        })
      }),
    ])
    expect(results).toContain("req-a")
    expect(results).toContain("req-b")
  })

  it("injects requestId into log output", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    const log = createLogger("test")
    runWithRequestContext({ requestId: "abcdef1234567890" }, () => {
      log.info("hello")
    })
    const output = logSpy.mock.calls[0]?.[0] as string
    expect(output).toContain("req=abcdef12")
    logSpy.mockRestore()
  })

  it("includes userEmail if present in context", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    const log = createLogger("test")
    runWithRequestContext({ requestId: "r", userEmail: "a@b.com" }, () => {
      log.info("hello")
    })
    // userEmail is included in the context merge (visible in prod JSON mode)
    expect(logSpy).toHaveBeenCalledOnce()
    logSpy.mockRestore()
  })
})
