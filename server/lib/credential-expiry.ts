/**
 * Whether a stored credential's access token is expired (or close enough that
 * it should be proactively refreshed).
 *
 * Pure + side-effect free so the refresh-coordination logic in index.ts can be
 * unit-tested without a DB or network. A null/absent `expiresAt` means "no
 * known expiry" and is treated as NOT expired (workspace bearer tokens, etc.).
 *
 * `skewMs` is a safety margin: refresh slightly before the real expiry so a
 * token doesn't lapse mid-request. Defaults to 60s.
 */
export function isCredentialExpired(
  expiresAt: string | null | undefined,
  skewMs = 60_000,
  now: number = Date.now(),
): boolean {
  if (!expiresAt) return false
  return new Date(expiresAt).getTime() <= now + skewMs
}
