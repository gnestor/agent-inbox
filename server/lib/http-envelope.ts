import { CONTRACT_VERSION } from "@hammies/contracts"
import { encodeApiError, encodeApiSuccess } from "@hammies/contracts/http"
import type { MiddlewareHandler } from "hono"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isVersioned(value: unknown): boolean {
  return isRecord(value) && value.contractVersion === CONTRACT_VERSION
    && (Object.hasOwn(value, "data") || Object.hasOwn(value, "error"))
}

export const versionedJsonEnvelope: MiddlewareHandler = async (c, next) => {
  await next()
  const response = c.res
  if (response.status === 204 || !response.headers.get("content-type")?.includes("application/json")) return
  const text = await response.text()
  let body: unknown
  try {
    body = JSON.parse(text) as unknown
  } catch {
    return
  }
  if (isVersioned(body)) return
  const payload = response.ok
    ? encodeApiSuccess(body)
    : encodeApiError(
        isRecord(body) && typeof body.code === "string" ? body.code : "request_failed",
        isRecord(body) && typeof body.error === "string" ? body.error : `Request failed with status ${response.status}`,
        undefined,
        response.headers.get("x-request-id") ?? undefined,
      )
  const headers = new Headers(response.headers)
  headers.set("content-type", "application/json; charset=UTF-8")
  headers.delete("content-length")
  c.res = new Response(JSON.stringify(payload), { status: response.status, statusText: response.statusText, headers })
}
