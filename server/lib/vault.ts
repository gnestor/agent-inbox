/**
 * Credential vault — re-exported from the shared `@hammies/auth` implementation.
 *
 * The encrypt/decrypt + CRUD logic moved to `@hammies/auth/server` (2026-06-07)
 * so inbox and studio share one vault. Persistence is injected: inbox calls
 * `configureCredentialStore({ query, queryOne, execute })` at server startup
 * (see server/index.ts). This shim keeps existing `./lib/vault.js` imports working.
 *
 * See packages/auth/openspec/specs/credential-vault/spec.md.
 */
export {
  encrypt,
  decrypt,
  storeUserCredential,
  getUserCredential,
  listUserCredentials,
  deleteUserCredential,
  storeWorkspaceCredential,
  getWorkspaceCredential,
  listWorkspaceCredentials,
  resolveCredential,
  seedWorkspaceCredentials,
  configureCredentialStore,
  getCredentialStore,
  type StoredCredential,
  type CredentialStore,
} from "@hammies/auth/server"
