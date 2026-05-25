// Telemetry endpoints — append-only JSONL files. Intentionally unauthenticated
// so that crash reports can still be posted from a partially-loaded tab where
// auth state may be unavailable. Same-origin CSRF protection still applies via
// the global middleware. Bodies are size-capped to prevent accidental abuse.

import { Hono, type Context } from "hono"
import { appendFile, mkdir } from "fs/promises"
import { dirname, resolve } from "path"
import { fileURLToPath } from "url"
import { createLogger } from "@hammies/frontend/lib/serverLogger"
import { getClientIp } from "../lib/rate-limit.js"

const log = createLogger("telemetry")

const __dirname = dirname(fileURLToPath(import.meta.url))
const TELEMETRY_DIR = resolve(__dirname, "../../data/telemetry")
const HEARTBEAT_FILE = resolve(TELEMETRY_DIR, "heartbeat.jsonl")
const CRASH_FILE = resolve(TELEMETRY_DIR, "crash.jsonl")

const MAX_BODY_BYTES = 16 * 1024

let dirReady: Promise<string | undefined> | undefined
function ensureDir() {
  if (!dirReady) dirReady = mkdir(TELEMETRY_DIR, { recursive: true })
  return dirReady
}

async function appendLine(file: string, payload: object): Promise<void> {
  await ensureDir()
  const line = JSON.stringify(payload) + "\n"
  if (Buffer.byteLength(line, "utf8") > MAX_BODY_BYTES) {
    throw new Error("payload too large")
  }
  await appendFile(file, line, "utf8")
}

function makeHandler(file: string, kind: "heartbeat" | "crash") {
  return async (c: Context) => {
    try {
      const body = await c.req.json()
      await appendLine(file, {
        receivedAt: new Date().toISOString(),
        ip: getClientIp(c),
        userAgent: c.req.header("user-agent") ?? "",
        ...body,
      })
      if (kind === "crash") log.warn("crash reported", body)
      return c.body(null, 204)
    } catch (err) {
      log.warn(`${kind} append failed`, { err: String(err) })
      return c.body(null, 204) // best-effort: never fail loudly
    }
  }
}

export const telemetryRoutes = new Hono()
telemetryRoutes.post("/heartbeat", makeHandler(HEARTBEAT_FILE, "heartbeat"))
telemetryRoutes.post("/crash", makeHandler(CRASH_FILE, "crash"))
