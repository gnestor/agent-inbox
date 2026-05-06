# Theming

## Purpose

Provide the inbox's visual surface: Tailwind v4 entry stylesheet, OKLCH design tokens, dark/light variants, scrollbar conventions, PWA manifest, and integration brand-icon assets. The frontend package (`@hammies/frontend`) supplies the base shadcn theme; this package's `src/index.css` is the consumer-side override layer plus PWA wiring.

## Context

### Why Tailwind v4 with `@source` / `@plugin`
Tailwind v4 replaces `tailwind.config.js` with directives inside the CSS entry. `src/index.css` `@import`s the frontend package's compiled styles and `@source "../../frontend/src"` so utility classes used inside `@hammies/frontend` components resolve in the inbox's build. Without that source declaration, JIT would see only `inbox/src` files and emit a stripped stylesheet for shared components.

### Why OKLCH for tokens
Token values use the OKLCH color space so dark/light variants can share a hue and lightness math without hand-tuning each pair. The single `--primary: oklch(0.54 0.27 259.29 / 0.7)` is reused across both `:root` and `.dark` because the alpha channel does the heavy lifting against the surface beneath.

### Why PWA wiring lives here
The app is installable on iOS and Android. `public/manifest.json` declares the standalone display mode, the theme color (matching the dark surface), and the 192/512 icons. `body { padding-top: env(safe-area-inset-top) }` ensures the status bar doesn't overlap the header in standalone mode.

### Service worker is intentionally minimal
`public/sw.js` exists to make the app installable and to clear old caches; it deliberately does NOT cache API responses (React Query owns client cache) and does NOT serve offline content.

### What is NOT in scope
- Component styling rules → `shared-ui-components` spec.
- Iframe theme propagation for sandboxed plugin/artifact renderers → owned by [`src/lib/iframe-theme.ts`](../../../src/lib/iframe-theme.ts) (covered under shared-ui-components).
- Brand voice or copy — only visual surface lives here.

## Requirements

### Stylesheet entry

#### Scenario: Inbox imports the frontend theme + prose + syntax styles
- **WHEN** Vite processes `src/index.css`
- **THEN** the entry imports `@hammies/frontend/styles`, `@hammies/frontend/prose.css`, `@hammies/frontend/one-syntax.css` first, then declares `@source "../../frontend/src"` so JIT scans shared component class usage.
- **AND** `@plugin "@tailwindcss/typography"` is loaded for `prose` styles inside rendered markdown.

#### Scenario: Scrollbars are thin globally
- **WHEN** any element scrolls
- **THEN** the global `* { scrollbar-width: thin }` rule applies — there is no per-component scrollbar restyling.

#### Scenario: Primary token uses OKLCH and is shared across themes
- **WHEN** the `--primary` and `--secondary` tokens are read
- **THEN** their values are OKLCH with an alpha channel, identical between `:root` and `.dark` for `--primary`.
- **AND** `--secondary` flips between black/white at low alpha to provide subtle contrast on each surface.

### PWA install surface

#### Scenario: Manifest declares standalone install mode
- **WHEN** a browser reads `public/manifest.json`
- **THEN** the document declares `display: "standalone"`, `start_url: "/"`, dark `background_color`/`theme_color`, and 192/512 PNG icons.

#### Scenario: Service worker registers without caching API responses
- **WHEN** the app loads
- **THEN** `public/sw.js` is registered to make the app installable and to clean up stale caches.
- **AND** it does NOT intercept `/api/*` — React Query is the only client-side cache layer.

#### Scenario: Standalone mode respects the status bar inset
- **WHEN** the PWA runs in standalone mode on iOS
- **THEN** `body { padding-top: env(safe-area-inset-top) }` pushes content below the dynamic status bar.

### Asset surface

#### Scenario: Integration brand icons live in `src/assets/icons/`
- **WHEN** an integration card renders its brand mark
- **THEN** the SVG is loaded from `src/assets/icons/<id>.svg` via Vite's asset pipeline.
- **AND** PWA-only icons (`icon-192.png`, `icon-512.png`) live in `public/icons/` because they must be served as-is without bundling.

### Vite types

#### Scenario: `__APP_VERSION__` is a defined global
- **WHEN** any TS file references `__APP_VERSION__`
- **THEN** the type comes from `src/vite-env.d.ts` and the value is injected by Vite's `define` config; React Query persistence uses it as the cache buster so a new build clears the persisted store.

## Technical Notes

| Concern | Location |
|---|---|
| Stylesheet entry, `@source`, OKLCH tokens, scrollbars | [src/index.css](../../../src/index.css) |
| PWA manifest (standalone, theme color, icons) | [public/manifest.json](../../../public/manifest.json) |
| Service worker (install/offline-stub) | [public/sw.js](../../../public/sw.js) |
| PWA app icons | [public/icons/](../../../public/icons/) |
| Integration brand icons | [src/assets/icons/](../../../src/assets/icons/) |
| Vite client types and `__APP_VERSION__` | [src/vite-env.d.ts](../../../src/vite-env.d.ts) |

## History

- Migrated from Tailwind v3 + `tailwind.config.js` to v4's CSS directives — required `@source` to be explicit because JIT could no longer see the workspace package via the config path mapping.
- Service worker scoped down to install-only after an early version cached `/api/sessions` and confused React Query's invalidation.
- Status-bar safe-area inset added after the iOS PWA covered the title bar with content.
