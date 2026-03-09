# Theming

## Color System

Colors are defined in [`packages/frontend/src/index.css`](../../../frontend/src/index.css) using OKLCH. The inbox imports these via `@import "@hammies/frontend/styles"` in its own `index.css`.

Dark/light mode is class-based: `ThemeProvider` adds `dark` or `light` to `<html>` based on the `storageKey="inbox-theme"` preference (defaulting to system). Tailwind dark variants use `@custom-variant dark (&:is(.dark *))`.

### Light Mode Visual Hierarchy

| Layer | Token | Value | Usage |
|---|---|---|---|
| Body background | `--background` | `oklch(1 0 0)` (white) | Page background between panels |
| Panels / sidebar | `--card`, `--sidebar` | `oklch(0.985 0.005 70)` (warm off-white) | Email list, session view, sidebar |
| Hover / accents | `--accent` | `oklch(0.83 0.095 65)` | Interactive hover states |

Panels use `bg-card` in `PanelStack` (desktop) and `bg-card` in `MobileOverlayPanel`. The sidebar token (`--sidebar`) is kept in sync with `--card` so they visually match.

### Dark Mode

Dark backgrounds have a warm orange-brown tint to complement the Hammies brand palette (`#FCECDD / #FFC288 / #FEA82F / #FF6701`):

- Background: `oklch(0.178 0.01 50)` — dark warm brown
- Card: `oklch(0.155 0.01 50)` — slightly darker than background (panels float above)
- Sidebar: `oklch(0.22 0.01 50)` — slightly lighter than card

## Syntax Highlighting

Handled by two mechanisms, both producing `hljs-*` CSS classes:

| Context | Mechanism |
|---|---|
| Tool use JSON (`HighlightedJson`) | `hljs.highlight()` from `highlight.js/lib/core` with json language registered |
| Markdown code fences (`ReactMarkdown`) | `rehype-highlight` plugin (uses `lowlight` internally) |

### CSS Theme

[`packages/inbox/src/index.css`](../src/index.css) imports the official GitHub light theme as a base:

```css
@import "highlight.js/styles/github.css";
```

Dark mode overrides are applied via `.dark .hljs-*` selectors, matching `github-dark.css` exactly. Key distinction: **JSON keys** (`hljs-attr`) get `#79c0ff` in dark mode while **string values** (`hljs-string`) get `#a5d6ff` — the GitHub dark theme treats these as separate token groups.

The `HighlightedJson` component adds `class="hljs"` to its `<code>` element so the base `.hljs { background }` rule applies, giving it the same background as rehype-highlighted markdown code blocks.
