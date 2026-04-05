// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { createLogger } from "../logger"

describe("client createLogger", () => {
  let logSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>
  let warnSpy: ReturnType<typeof vi.spyOn>
  let debugSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    errorSpy.mockRestore()
    warnSpy.mockRestore()
    debugSpy.mockRestore()
  })

  it("logs with module tag", () => {
    const log = createLogger("client-test")
    log.info("user clicked")
    expect(logSpy).toHaveBeenCalled()
    const output = logSpy.mock.calls[0]?.[0] as string
    expect(output).toContain("[client-test]")
    expect(output).toContain("user clicked")
  })

  it("formats context", () => {
    const log = createLogger("client-test")
    log.warn("slow", { durationMs: 500, url: "/api/x" })
    const output = warnSpy.mock.calls[0]?.[0] as string
    expect(output).toContain("durationMs=500")
    expect(output).toContain("url=/api/x")
  })

  it("child logger inherits default context", () => {
    const log = createLogger("client-test").child({ sessionId: "s1" })
    log.error("boom", { code: 500 })
    const output = errorSpy.mock.calls[0]?.[0] as string
    expect(output).toContain("sessionId=s1")
    expect(output).toContain("code=500")
  })

  it("debug level uses console.debug", () => {
    const log = createLogger("client-test")
    log.debug("detail")
    expect(debugSpy).toHaveBeenCalled()
  })
})
