# Navigation

## Purpose

A 2D navigation grid: tabs run vertically in the sidebar (settings, plugins, sessions, ephemeral `recent:*`), and panels stack horizontally per tab (list → detail → session → output → code editor → ...). Backed by a single Zustand store (`useNavigationStore`) with selective subscriptions, persisted to IndexedDB with a versioned schema, and bidirectionally synced with the browser URL. Adds `replacePanel`, `savedPanels`-per-item restoration, and animation hints (`itemDirection`, `panelTransition`) so transitions remain stable across the many ways a panel can appear.

## Context

### Why a single Zustand store, not a context + reducer
Earlier shapes used `NavigationContext` + `useReducer`, which forced every consumer to re-render on any state change. The store exposes selector hooks (`useActiveTab`, `useTabPanels`, `useSelectedItemId`, `useItemDirection`, `usePanelTransition`, `useActiveFilters`, `useSourceTab`) so only components watching a specific slice re-render. Action references are stable (Zustand `set` closures) — `useNavActions()` returns the same function identities across renders, which keeps button `onClick` props from churning.

### Why a 2D grid (tabs × panels)
Each tab owns its own panel stack so switching tabs preserves where you were within that tab. A user reading email A in the Gmail tab and switching to Sessions and back lands on email A's detail panel — the alternative (single shared stack) would force a re-navigation on every tab switch. The trade-off is that state is per-tab plus a `savedPanels` map per item within a tab; the store helpers hide this complexity behind `selectItem`/`pushPanel`.

### Why `savedPanels` per item
When the user opens a session from email A's detail panel (panels: list, detail, session) and then selects email B in the list, panels become (list, detail-B, session-B-or-empty). Without `savedPanels`, returning to email A would lose the session panel that was open. `selectItem` calls `saveExtraPanels(tab)` first, which snapshots `panels.slice(2)` keyed by the previous `selectedItemId`; re-selecting that item restores them.

### Why `panelTransition` and `itemDirection`
Two animation contexts exist: list-item navigation (slide up/down based on whether the new item is above or below) and panel push/pop (no slide; the new panel is appended). `panelTransition: "item"` plus `itemDirection: 1 | -1` drives `<PanelSlot>`'s `panel-slide-in-{up,down}` keyframes; `panelTransition: "none"` suppresses the slide so push/pop just appears. `prevListIndex` is tracked on the tab so direction can be computed from the delta on each `selectItem`.

### Why IndexedDB instead of localStorage
The persisted blob includes per-tab panel arrays, `savedPanels` maps, and filters — easily 10+ KB on heavy users. Versioned via `INBOX_NAV_STATE_VERSION` (currently `3`); on version mismatch the persisted state is dropped to avoid replaying a panel shape that no longer exists. `validateState()` strips panels with unknown `type` values from both `tabs[*].panels` and `tabs[*].savedPanels[*]`.

### Why `new_session` is excluded from persisted panel types
A "new session" compose panel is transient — reloading the app shouldn't drop the user back into a half-typed message. The `validTypes` set in `navigation-storage.ts` deliberately omits `new_session` so it's stripped on load even though the runtime store accepts it.

### Why some React Query keys are excluded from the persisted query cache
`main.tsx` persists the React Query cache to IndexedDB (`INBOX_QUERY_CACHE_V3`) so list/detail data renders instantly on reload. The `isTransientQuery` predicate (in [`src/lib/query-persistence.ts`](../../../src/lib/query-persistence.ts)) excludes keys whose persisted copy would mislead: `sessions`/`session` (the agent rewrites the JSONL constantly, so a stale copy shows pre-edit code) and `connections` (status must reflect the server immediately after an OAuth round-trip — persisting it left the "Connect" button stale on reload; see the [integrations](../integrations/spec.md) spec). Error/pending queries are never persisted. Infinite-query (`pages`) shapes are excluded too — **except** `plugin-items-infinite`, the plugin list, which loads its full result set in one page and so restores instantly on reload like every other list.

### Why `recent:*` tabs are ephemeral
"Recent" tabs (URL: `/recent/sessions/<sid>` or `/recent/<plugin>/<itemId>/session/<sid>`) represent an open detail-from-search-or-history view. They're built on demand via `createRecentTabState()` from URL parts and aren't seeded into `defaultState.tabs` — they only exist while the user has them in the sidebar.

### Why URL is the source of truth on first paint
The mount effect runs `parseUrl(location.pathname)` synchronously *before* the IndexedDB hydration resolves and pre-populates `tabs[parsed.tabId]` with list+detail (and session, if present in URL). This avoids a flash of the wrong tab between paint and async hydration. `useHydratedPanels` further gates panel visibility — it shows only the list panel before `_initialized`, unless URL sync already produced detail panels (`panels.length > 1`), in which case those are shown immediately.

### What is NOT in scope
- Per-panel rendering (which component to render for `type: "session"`, etc.) → `session-views-controller` and per-domain specs.
- Sidebar tab rendering and reordering → `shared-ui-components` (`<Tab>`, `<NavigationProvider>` are wired here but the visual chrome lives in shared-ui).
- Animation styles (`panel-slide-*` keyframes, scroll snap) → `theming` / `shared-ui-components`.

## Requirements

### Tab and panel model

#### Scenario: Tabs are typed, including dynamic plugin and recent tabs
- **WHEN** code reads or assigns a `TabId`
- **THEN** the type is `"sessions" | "settings" | "workspace-settings" | \`plugin:${string}\` | \`recent:${string}\``.
- **AND** `pluginIdFromTab(id)` extracts the suffix for `plugin:*` tabs and returns `undefined` otherwise.

#### Scenario: PanelState is a discriminated union
- **WHEN** a panel is pushed to a tab's stack
- **THEN** it matches one of: `list`, `detail`, `session`, `new_session`, `output`, `code_editor`, `ask_user`, `subagent`, `compose`, `settings`.
- **AND** each variant carries its `props` shape (e.g. `detail` has `{ itemId }`, `session` has `{ sessionId; linkedItemId? }`).

#### Scenario: Each tab owns its panel stack and per-tab state
- **WHEN** a user switches between tabs
- **THEN** `tabs[tabId]` carries `panels`, `selectedItemId`, `panelScrollOffset`, `activeFilters`, `itemDirection`, `prevListIndex`, `savedPanels`, `panelTransition`, `sourceTab`, `sidebarIndex`.
- **AND** the active tab's state is restored verbatim on switch — no cross-tab leakage.

### Store actions

#### Scenario: `switchTab` creates a default tab on first visit
- **WHEN** `switchTab(tabId)` runs and `tabs[tabId]` is undefined
- **THEN** the store creates the tab via `createDefaultTabState()` (`panels: [{ id: "list", type: "list", props: {} }]`).

#### Scenario: `selectItem` saves prior extra panels before swapping
- **WHEN** `selectItem(itemId, listIndex?)` runs
- **THEN** the helper `saveExtraPanels` snapshots the current item's `panels.slice(2)` into `savedPanels[selectedItemId]` (or clears that entry if no extras remain).
- **AND** `panels` is reset to `[list, detail-of-itemId, ...savedPanels[itemId] ?? []]`.
- **AND** when `listIndex` is provided, `itemDirection` is set to `1` if the new index is greater than `prevListIndex`, else `-1`.
- **AND** `panelTransition` is set to `"item"` so `<PanelSlot>` plays the slide animation.

#### Scenario: `pushPanel` is idempotent by panel id
- **WHEN** `pushPanel(panel)` is called and the active tab already has a panel with the same `id`
- **THEN** the store returns unchanged state (no duplicate push).
- **AND** `panelTransition` is set to `"none"` so the new panel appears without sliding.

#### Scenario: `popPanel` clears `selectedItemId` if no detail panel remains
- **WHEN** `popPanel(panelId)` truncates `panels` at the matched index
- **THEN** if no `type: "detail"` panel remains, `selectedItemId` is cleared so list/detail layout returns to list-only.
- **WHY:** the URL builder reads `selectedItemId` to decide whether to emit `/sessions/<id>` vs `/sessions`; leaving it set after popping the detail panel produces a stuck URL.

#### Scenario: `replacePanel` swaps a single panel by id
- **WHEN** `replacePanel(panelId, newPanel, selectedItemId?)` runs
- **THEN** the matched panel is replaced in place; if `selectedItemId` is provided it overrides the tab's selected id (used when a detail panel is replaced with a session that targets a different item).

#### Scenario: `openSession` replaces an existing session panel rather than appending
- **WHEN** `openSession(sessionId)` runs and a `type: "session"` panel already exists
- **THEN** that panel is replaced in place (not duplicated).
- **AND** otherwise a new `session:<id>` panel is appended.

#### Scenario: `openNewSession` keeps detail when invoked from a detail view
- **WHEN** `openNewSession({ type, id, content })` is called
- **THEN** the store keeps `list` + `detail` panels and appends `new_session`.
- **AND** when called with no source (the "+" button), `selectedItemId` is cleared and panels become `[list, new_session]`.

#### Scenario: `openRecent` builds an ephemeral `recent:<sessionId>` tab
- **WHEN** the user opens a recent session from the sidebar
- **THEN** a `recent:<sessionId>` tab is created (or reused) via `createRecentTabState`.
- **AND** `sourceTab` records the originating tab so `buildRecentUrl` can produce the right path.
- **AND** `sidebarIndex` and `itemDirection` are computed from the previous recent tab's index for animation continuity.

#### Scenario: `setFilter` strips empty values
- **WHEN** `setFilter(key, "")` is called
- **THEN** `cleanFilters` drops the key from `activeFilters`; if no keys remain, `activeFilters` becomes `undefined`.

### Hydration and persistence

#### Scenario: URL is the source of truth on first paint
- **WHEN** `<NavigationProvider>` mounts
- **THEN** `parseUrl(location.pathname)` runs synchronously and the store is pre-populated with the URL-derived `activeTab` and panel layout (`list + detail [+ session]`) before the first React render commits.
- **WHY:** waiting for IndexedDB hydration would flash the default sessions tab on every reload.

#### Scenario: IndexedDB hydration merges with URL
- **WHEN** `loadNavigationState()` resolves
- **THEN** the persisted state is merged with the URL-derived tab (URL wins for `selectedItemId` and panel composition; persisted `savedPanels`, `activeFilters`, scroll offsets are kept).
- **AND** `_initialized: true` flips so URL-sync effects start running.

#### Scenario: Version mismatch drops persisted state
- **WHEN** the stored `INBOX_NAV_STATE_VERSION` is less than `CURRENT_VERSION` (3)
- **THEN** the persisted blob is deleted and `loadNavigationState()` returns `null`.
- **WHY:** old persisted state may reference panel types or props that no longer exist; replaying it would crash the panel renderer.

#### Scenario: Unknown panel types are stripped on load
- **WHEN** the persisted state contains a panel whose `type` is not in the `validTypes` allowlist
- **THEN** that panel is filtered out of both `tabs[*].panels` and `tabs[*].savedPanels[*]`.
- **AND** `new_session` is not in `validTypes`, so any persisted compose panel is dropped.

#### Scenario: `sessions` tab always exists
- **WHEN** `validateState` runs
- **THEN** if `state.tabs.sessions` is missing it's recreated via `createDefaultTabState()`.
- **AND** any tab whose id starts with `plugin:` or equals `sessions` has a `list` panel ensured at position 0.

#### Scenario: Save is debounced
- **WHEN** the store updates after hydration
- **THEN** the persistence subscriber clears any pending timer and schedules `saveNavigationState` 100 ms later, collapsing rapid changes into a single write.

### URL sync

#### Scenario: `buildUrl` covers settings, plugins, sessions, and recent
- **WHEN** the active tab and selected id are stable
- **THEN** `buildUrl` returns: `"/settings/integrations"` for settings; `/<pluginId>[/encoded(itemId)]` for `plugin:*`; `/sessions[/encoded(id)]` for sessions; `/recent/sessions/<sid>` or `/recent/<pluginId>/<itemId>[/session/<sid>]` for recent.

#### Scenario: State changes drive the URL
- **WHEN** `activeTab`, `selectedItemId`, or the active tab state changes after hydration
- **THEN** the provider compares the computed URL with `lastNavigatedUrl.current` and calls `navigate(url)` only on actual change to avoid history spam.

#### Scenario: Browser back/forward drives state
- **WHEN** `location.pathname` changes via the browser
- **THEN** `parseUrl` extracts the target tab and selection, and the provider calls `switchTab` / `selectItem` / `deselectItem` / `openSession` to converge.
- **AND** `recent:*` paths bypass `switchTab` and rebuild the tab via `createRecentTabState` to handle freshly-opened recent links.

### Selectors and stable references

#### Scenario: Empty selectors return stable fallbacks
- **WHEN** `useTabPanels` or `useActiveFilters` is called for a tab whose state is missing the slice
- **THEN** the hook returns the module-level `EMPTY_PANELS` / `EMPTY_FILTERS` constants — never a fresh `[]` / `{}`.
- **WHY:** Zustand subscribers compare by reference; returning a new array each call would re-render every consumer on every store change.

#### Scenario: `useHydratedPanels` gates panels until hydration completes
- **WHEN** `_initialized` is false
- **THEN** the hook returns only `panels.filter((p) => p.type === "list")` — *unless* the synchronous URL-sync already produced `panels.length > 1`, in which case those are returned to avoid a flash.

#### Scenario: `useNavActions` returns stable function identities
- **WHEN** any component calls `useNavActions()`
- **THEN** the returned object is shallow-equal across renders (Zustand actions never change reference), so consumers can pass them as props without churning child memoization.

## Technical Notes

| Concern | Location |
|---|---|
| `TabId`, `PanelState`, `TabState`, `getTabIndex`, `pluginIdFromTab` | [src/types/navigation.ts](../../../src/types/navigation.ts) |
| Zustand store, actions, `saveExtraPanels`, `createRecentTabState` | [src/lib/navigation-store.ts](../../../src/lib/navigation-store.ts) |
| Selector hooks (`useActiveTab`, `useTabPanels`, `useHydratedPanels`, `useNavActions`, ...) | [src/lib/navigation-store.ts:246-343](../../../src/lib/navigation-store.ts#L246-L343) |
| IndexedDB persistence, version migration, `validateState`, `cleanFilters` | [src/lib/navigation-storage.ts](../../../src/lib/navigation-storage.ts) |
| `<NavigationProvider>`, `buildUrl`, `parseUrl`, hydration + URL sync effects | [src/components/navigation/NavigationProvider.tsx](../../../src/components/navigation/NavigationProvider.tsx) |
| `<PanelSlot>` slide animation driven by `usePanelTransition` + `useItemDirection` | [src/components/navigation/PanelSlot.tsx](../../../src/components/navigation/PanelSlot.tsx) |
| Animation duration, easing, panel width, gap | [src/lib/navigation-constants.ts](../../../src/lib/navigation-constants.ts) |
| Backward-compat hook wrapping the store | [src/hooks/use-navigation.ts](../../../src/hooks/use-navigation.ts) |
| App shell (sidebar, routing, panel composition entry) | [src/App.tsx](../../../src/App.tsx) |
| Vite entry / React root, persisted query client wiring | [src/main.tsx](../../../src/main.tsx) |
| `isTransientQuery` — which React Query keys are excluded from IndexedDB persistence | [src/lib/query-persistence.ts](../../../src/lib/query-persistence.ts) |
| `<Panel>` panel container with mobile/width handling | [src/components/navigation/Panel.tsx](../../../src/components/navigation/Panel.tsx) |
| `<PanelContent>` panel-type-to-renderer dispatch with editor overlay | [src/components/navigation/PanelContent.tsx](../../../src/components/navigation/PanelContent.tsx) |
| `<Tab>` tab container coordinating its panel stack | [src/components/navigation/Tab.tsx](../../../src/components/navigation/Tab.tsx) |
| `<SlotStack>` vertical scroll-snap tab switcher | [src/components/navigation/SlotStack.tsx](../../../src/components/navigation/SlotStack.tsx) |
| Navigation barrel exports | [src/components/navigation/index.ts](../../../src/components/navigation/index.ts) |
| Touch swipe hook (panel back-gesture) | [src/hooks/use-swipe.ts](../../../src/hooks/use-swipe.ts) |

## History

- Migrated from `NavigationContext` + `useReducer` to Zustand after profiling showed every keystroke in a filter input rerendering every panel; selective subscriptions cut wasted renders by an order of magnitude.
- `savedPanels` per-item map added after users complained that opening a session from one email and then clicking a different email lost the first session — the second selection was wiping the panel stack.
- `validTypes` allowlist introduced after a deleted panel type (`artifact`) crashed the app on reload because the persisted state still referenced it. The allowlist is permissive (allows `artifact`) but strict for unknown types.
- `useHydratedPanels` added after a flash where panel-3 (session) was visible for a frame before IndexedDB hydration produced its props — gating on `_initialized` plus the URL-sync escape hatch resolved both the flash and the regression where a fresh URL load showed only the list panel.
- IndexedDB version bumps to 3 documented dropped state migrations: each bump corresponds to a panel-shape change that was easier to drop than to migrate.
