/**
 * Integration registry — re-exported from the shared `@hammies/auth` catalog.
 *
 * The registry moved to `@hammies/auth/server` (2026-06-07) so inbox and studio
 * share one source of truth. This shim keeps existing `./lib/integrations.js`
 * imports working. See packages/auth/openspec/specs/integrations/spec.md.
 */
export {
  type IntegrationConfig,
  INTEGRATIONS,
  getIntegration,
  getOAuthIntegrations,
  buildEnvToIntegrationMap,
  // Plugin-aggregation: inbox registers workspace plugins' declared integrations
  // at boot (the same path Studio runs), so a plugin-only integration is visible
  // to inbox's connections UI + credential proxy. See @hammies/auth
  // plugin-integrations.ts and this package's plugin-system spec.
  registerPluginIntegrations,
  discoverWorkspacePluginIntegrations,
} from "@hammies/auth/server"
