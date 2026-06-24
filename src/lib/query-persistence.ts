/**
 * Predicate for the React Query → IndexedDB persistence layer (see main.tsx).
 * Returns true for queries that must NOT be persisted because a stale restored
 * copy would mislead on reload.
 *
 * Used by both the dehydrate filter (what gets written) and the deserialize
 * filter (what gets restored), so the two stay in lockstep.
 */
export function isTransientQuery(
  status: string,
  queryKey: readonly unknown[],
  data: unknown,
): boolean {
  if (status === "error" || status === "pending") return true
  if (queryKey[0] === "sessions") return true
  // Connection status must always reflect the server after an OAuth round-trip.
  // Persisting it serves a stale "Connect" state on reload (see use-connections).
  if (queryKey[0] === "connections") return true
  // Individual session transcripts change every time the agent writes to the JSONL
  // (or the user edits an artifact). Serving the persisted copy on reload shows
  // pre-edit code and confuses users; always re-fetch the authoritative version.
  if (queryKey[0] === "session") return true
  // The plugin list is an infinite query but SHOULD persist — it loads its full
  // result set in one page, so the restored copy is complete (not a partial
  // paginated view) and the list renders instantly on reload like Studio's.
  // Whitelist it before the blanket infinite-query exclusion below.
  if (queryKey[0] === "plugin-items-infinite") return false
  // Other infinite-query (`pages`) results aren't persisted — partial/large
  // paginated data whose restored copy could mislead.
  if (data && typeof data === "object" && "pages" in data) return true
  return false
}
