# Plugin System

## Purpose

Discovery, loading, registry, and HTTP/component plumbing for inbox plugins. A plugin is a TypeScript/JS module exporting a `Plugin` (or `Plugin[]`) default — a `query`/`mutate`/`itemToContext`/`extractEntities`-shaped object plus optional `fieldSchema`, `detailSchema`, and `components/` directory. The loader merges built-in plugins (`packages/inbox/plugins/*`) with workspace plugins (`{workspace}/plugins/*/plugin.ts` and the legacy `{workspace}/inbox-plugins/*.ts`), exposes them via `getPlugins(workspaceId)`, auto-mounts REST routes at `/api/:pluginId/*`, hot-reloads on file changes, and serves plugin React components as ES modules transformed by esbuild and embedded in sandboxed iframes.

## Context

### Why plugins live on the filesystem, not the database
A plugin is code — credentials, query logic, side-effect mutations. Storing the source in a DB blob and `eval`-ing it at runtime would give every workspace user code-execution privileges over every other workspace user. Filesystem plugins put the trust boundary at "who can write into the workspace directory" — which the deployment already controls.

### Why the loader uses `import(path + "?v=" + Date.now())`
Node's ESM module cache is keyed by URL. Without a unique query string, a second `import(path)` after the file changes returns the old module object — the plugin watcher's hot-reload would silently no-op. The cache-busting query gives every reload a fresh URL, which Node treats as a new module. The cost is a small steady-state heap leak across many reloads; acceptable in a dev-watch context, and the production path doesn't reload.

### Why workspace plugins override built-ins by ID
Built-in `gmail` ships with `query()` and basic schemas; the `agent` workspace's `gmail` plugin adds `itemToContext` and `enrichForContext` for the curation pipeline. Per-workspace registry merge (`getPlugins`: workspace map on top of builtin map by ID) lets the workspace extend a builtin without forking it. This is intentional — multiple workspaces can layer different extensions over the same builtin without colliding.

### Why a `Plugin[]` default export is supported
The Notion plugin file exports two plugins (`notion-tasks`, `notion-pages`) backed by the same Notion client. Forcing two files would duplicate the client setup; allowing `export default [taskPlugin, pagePlugin]` keeps shared infra together. `toPluginArray` normalises both shapes.

### Why `isValidPlugin` accepts skills-only plugins
The `core` plugin has `hasSkills: true` and no `query`/`itemToContext` — it provides Claude skills without a sidebar tab. Without the `hasSkills === true` clause, validation would reject it and the `plugin-creator` / `render-output` / `context-manager` skills would be unavailable to agents.

### Why `loadPlugins` clears non-builtin entries on reload
Hot-reload writes the new plugin set into the registry. If the previous reload had registered a plugin that no longer exists in the new directory listing, the stale entry would linger forever. Clearing all non-builtin entries before re-scanning ensures the registry is exactly what's on disk; built-ins are protected by the `builtinIds` set so a workspace can't accidentally clobber them.

### Why the watcher debounces by 500ms and uses non-recursive watch
A plugin save event commonly fires multiple FS notifications (write, atomic-rename, etc.). Reloading on every event would thrash, breaking in-flight requests mid-import. 500ms is the minimum that empirically de-duplicates editor saves without feeling laggy. Recursive watching across `node_modules` is also explicitly avoided — `node_modules` exists in plugin directories that have a build step, and recursive watch there exhausts file descriptors (`EMFILE`) on macOS.

### Why component code is served as ES modules, not bundled into the SPA
A plugin's React component cannot ship in the SPA bundle — the SPA is built once per release, plugins are loaded per-workspace at runtime. Serving each component through `/api/:pluginId/components/:name` (esbuild-transformed on demand, LRU-cached at `COMPONENT_CACHE_MAX = 50`) lets new/edited components render immediately without rebuilding the SPA. The component is loaded inside a sandboxed iframe via the importmap convention (`react`/`react-dom`/`@hammies/frontend/*` resolve to the parent's bundled artifacts), so the plugin can't pull in arbitrary npm packages.

### Why iframes use `srcDoc` + null origin but `allow-same-origin`
`srcDoc` gives the iframe a null origin — it cannot read the parent's cookies or `localStorage`. `allow-same-origin` is required so the importmap's relative URLs resolve against the parent server (the iframe's null origin would otherwise refuse cross-origin module imports). The combination is the standard "trusted iframe sandbox" pattern: same-origin enough to load modules, null-origin enough to be a security boundary.

### Why every plugin route resolves through `getWorkspaceId(c)`
Plugin instances are workspace-scoped — a workspace's gmail credential and query targets are different from another workspace's. `pluginRoutes` reads `c.get("workspace")` injected by the auth middleware and looks up the merged plugin set for that workspace. Without this, a request would hit the global builtin instead of the workspace's overridden version.

### What is NOT in scope
- Per-plugin `query`/`mutate` body content (Gmail labels, Notion blocks) → individual plugin specs (e.g. `gmail-plugin`).
- The `core` skills package (plugin-creator, render-output, context-manager) → `core-plugin` spec.
- Credential resolution inside `PluginContext.getCredential` and Google token refresh → `context-system` (specifically `plugin-context.ts`).
- Skills metadata file format → consumed via the Claude SDK's skills loader, not this spec.
- Sidebar nav and item selection → `navigation` spec.

## Requirements

### Plugin shape

#### Scenario: A plugin is a default export with `id` plus at least one of `query`/`hasSkills`/`itemToContext`
- **WHEN** the loader imports a candidate file
- **THEN** `isValidPlugin` requires `typeof id === "string" && id.length > 0` AND at least one of: `typeof query === "function"`, `hasSkills === true`, or `typeof itemToContext === "function"`.
- **AND** anything failing validation is logged at `warn` and skipped — a broken plugin must never crash the loader.

#### Scenario: A file may default-export `Plugin` or `Plugin[]`
- **WHEN** the loader sees a default export
- **THEN** `toPluginArray` normalises a single plugin to `[plugin]` and an array passes through; both registration paths are identical.

### Discovery and registry

#### Scenario: Built-in plugins are loaded once and survive workspace reloads
- **WHEN** the server starts
- **THEN** `loadBuiltinPlugins(packages/inbox/plugins/)` scans each subdirectory for `plugin.ts`/`plugin.js`, calls `registerPlugin` (which adds to `registry` AND `builtinIds`), and records the directory in `pluginDirs`.
- **AND** subsequent `loadPlugins` calls do not clear entries whose IDs are in `builtinIds`.

#### Scenario: Workspace plugins live in `{workspace}/plugins/*/plugin.ts`, with legacy fallback
- **WHEN** `loadPlugins(workspacePath, workspaceId)` runs
- **THEN** the loader scans `{workspace}/plugins/*/plugin.{ts,js}` first, then `{workspace}/inbox-plugins/*.{ts,js}` as a backward-compatibility fallback.
- **AND** a workspace plugin with the same ID as a builtin is allowed and overrides the builtin via the per-workspace registry — not by mutating the global `registry`.

#### Scenario: `getPlugins(workspaceId)` merges workspace registry on top of built-ins
- **WHEN** any consumer reads the plugin list
- **THEN** built-ins are added first, then the workspace map keyed by `workspaceId` overwrites by ID — the result is `[...builtin, ...workspace overrides]` with workspace winning ties.
- **AND** without a workspace ID, only built-ins are returned.

### Hot-reload

#### Scenario: Watcher reloads plugins on file changes with 500ms debounce
- **WHEN** any file under `{workspace}/plugins/` (recursive, but `node_modules` and dotfiles ignored) changes
- **THEN** `scheduleReload` debounces 500ms, then calls `loadPlugins(ws.path, ws.id)` followed by `mountPluginRoutes(app)`.
- **AND** errors are logged but do not crash the server.

#### Scenario: Watcher cleanup on shutdown
- **WHEN** `stopWatching()` is invoked
- **THEN** all pending debounce timers are cleared and every `FSWatcher` is closed.

### REST surface

#### Scenario: `GET /api/plugins` lists tab-eligible plugins for the workspace
- **WHEN** the SPA fetches the plugin manifest
- **THEN** the route returns `getPlugins(workspaceId).filter(p => p.fieldSchema?.length > 0)` mapped to `{ id, name, icon, emoji, components, auth, fieldSchema, detailSchema, listRowHeight, hasSubItems, hasGetItem, hasFilterOptions }`.
- **AND** skills-only plugins (`core`) are excluded — they have no tab.

#### Scenario: `GET /api/:pluginId/components/:name` esbuild-transforms TSX to ESM with LRU cache
- **WHEN** the iframe requests a plugin component
- **THEN** the route resolves the component file from the plugin's directory (via `getPluginDir`), the workspace plugin path, or `BUILTIN_PLUGINS_ROOT`; transforms with `esbuild.build`; serves as `text/javascript`.
- **AND** results are cached in `componentCache` keyed by `pluginId/name` with a max of 50 entries, invalidated by file `mtime`.

#### Scenario: Item routes fan out to plugin functions
- **WHEN** the SPA hits `GET /:pluginId/items` / `GET /:pluginId/items/:itemId` / `GET /:pluginId/items/:itemId/subitems` / `POST /:pluginId/items/:itemId/mutate` / `GET /:pluginId/fields/:fieldId/options`
- **THEN** the route resolves the workspace's plugin via `getPlugin(pluginId, workspaceId)` and invokes the corresponding `query`/`getItem`/`querySubItems`/`mutate`/`filterOptions` method with a `PluginContext` built from the request.

### Component embedding

#### Scenario: Plugin component HTML is built with importmap + null-origin srcDoc
- **WHEN** `buildPluginComponentHtml(pluginId, name, props, origin)` runs
- **THEN** the document declares CSP `default-src 'none'; script-src 'unsafe-inline' ${origin}; style-src 'unsafe-inline' ${origin}; connect-src 'self'; img-src * data: blob:; font-src *;` and an importmap mapping `react`, `react-dom`, `@hammies/frontend/components/ui`, `@hammies/frontend/lib/utils` to the parent server's prebuilt module URLs.
- **AND** the iframe loads `${origin}/api/${pluginId}/components/${componentName}` as a `type="module"` script and exposes a postMessage bridge: `navigate`, `selectItem`, `pushPanel`, `getPluginId`, `sendAction`, `saveState`, `__onStateRestored`.
- **AND** props are JSON-encoded with `<` escaped (`<`) to prevent script-tag breakouts.

### Validation safety

#### Scenario: Plugin loader tolerates ENOENT and ERR_MODULE_NOT_FOUND silently
- **WHEN** a plugin candidate path doesn't exist or has no module
- **THEN** the loader continues to the next file/directory without logging an error.
- **AND** any other error (parse failure, throw at module top-level) is logged at `error` level and the plugin is skipped — it does not abort the loader.

## Technical Notes

| Concern | Location |
|---|---|
| Plugin discovery, validation, registry, builtin/workspace merge | [server/lib/plugin-loader.ts](../../../server/lib/plugin-loader.ts) |
| Hot-reload file watcher (500ms debounce, recursive minus node_modules) | [server/lib/plugin-watcher.ts](../../../server/lib/plugin-watcher.ts) |
| Auto-mounted plugin REST routes (`/api/:pluginId/*`) and component esbuild | [server/routes/plugins.ts](../../../server/routes/plugins.ts) |
| Iframe HTML for plugin components (CSP + importmap + postMessage bridge) | [src/lib/build-plugin-component-html.tsx](../../../src/lib/build-plugin-component-html.tsx) |
| Plugin interface types (`Plugin`, `PluginItem`, `FieldDef`, `BadgeConfig`, `FilterConfig`) | [src/types/plugin.ts](../../../src/types/plugin.ts) |
| Loader test coverage | [server/lib/__tests__/plugin-loader.test.ts](../../../server/lib/__tests__/plugin-loader.test.ts) |
| Plugin route tests | [server/routes/__tests__/plugins.test.ts](../../../server/routes/__tests__/plugins.test.ts) |
| Workflow panel registry (loads `workflows/*` widget schemas + mutations) | [server/lib/panel-registry.ts](../../../server/lib/panel-registry.ts) |
| `/api/panels` and `/api/panels/mutate/:action` routes | [server/routes/panels.ts](../../../server/routes/panels.ts) |
| `<PanelWidget>` schema-driven widget renderer | [src/components/plugin/PanelWidget.tsx](../../../src/components/plugin/PanelWidget.tsx) |
| `<PluginView>` plugin tab composition (list + detail panels) | [src/components/plugin/PluginView.tsx](../../../src/components/plugin/PluginView.tsx) |
| `<PluginList>` generic plugin list panel | [src/components/plugin/PluginList.tsx](../../../src/components/plugin/PluginList.tsx) |
| `<PluginDetail>` generic plugin detail panel | [src/components/plugin/PluginDetail.tsx](../../../src/components/plugin/PluginDetail.tsx) |
| `<PluginFrame>` iframe host for plugin-supplied components | [src/components/plugin/PluginFrame.tsx](../../../src/components/plugin/PluginFrame.tsx) |
| `<PropertiesPopover>` shared edit popover for plugin item fields | [src/components/plugin/PropertiesPopover.tsx](../../../src/components/plugin/PropertiesPopover.tsx) |
| Plugin data hooks (`usePlugins`, `usePluginItems`, `usePluginItem`, sub-items) | [src/hooks/use-plugins.ts](../../../src/hooks/use-plugins.ts) |
| Plugin item mutation hook with optimistic patches | [src/hooks/use-plugin-mutations.ts](../../../src/hooks/use-plugin-mutations.ts) |

## History

- The cache-busting `?v=Date.now()` was added after a hot-reload regression where edits to a plugin file silently no-op'd; root cause was Node's ESM cache returning the original module object.
- The legacy `{workspace}/inbox-plugins/*.ts` path remains supported because early workspaces predate the `plugins/<id>/plugin.ts` directory convention; the loader scans both.
- Recursive plugin watching used to include `node_modules`, which started exhausting macOS file descriptors with `EMFILE` errors as plugins gained build steps; the watcher was changed to ignore the path inline.
- `isValidPlugin` originally required `query` to be a function; the `hasSkills`/`itemToContext` clauses were added when the `core` skills-only plugin and the curation-pipeline plugins started shipping without `query`.
- Plugin component caching capped at 50 after profiling showed the cache growing linearly with edited components in long dev sessions; LRU + mtime invalidation handles both eviction and freshness.
- The `Plugin[]` default-export shape was added when Notion's two surfaces (tasks + pages) needed to share the same Notion client without forking files.
