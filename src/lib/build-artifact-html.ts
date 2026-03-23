import { escapeForScript } from "./artifact-transform"

// CSS variable names to forward from the app theme into the iframe
const THEME_VARS = [
  "background", "foreground", "card", "card-foreground",
  "primary", "primary-foreground", "secondary", "secondary-foreground",
  "muted", "muted-foreground", "border", "input", "ring",
  "destructive", "destructive-foreground",
  "accent", "accent-foreground",
  "popover", "popover-foreground",
  "chart-1", "chart-2", "chart-3", "chart-4", "chart-5",
  "radius", "font-sans", "font-mono",
] as const

const THEME_VARS_JSON = JSON.stringify(THEME_VARS)

/**
 * Build an HTML document that loads React UMD, Tailwind CDN, and the
 * @hammies/frontend component bundle as an ES module via import map.
 *
 * The artifact code is pre-transformed (JSX → createElement) in the parent
 * and embedded as a base64 data attribute.
 */
export function buildArtifactHtml(
  code: string | undefined,
  title?: string,
  exportedName?: string | null,
): string {
  if (!code) return `<!DOCTYPE html><html><body style="font-family:sans-serif;"><p>No artifact code provided.</p></body></html>`
  const safeTitle = (title ?? "Artifact").replace(/[<>&"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c] ?? c)
  )
  const safeCode = escapeForScript(code)
  const origin = typeof window !== "undefined" ? window.location.origin : ""

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' ${origin} https://esm.sh https://cdn.jsdelivr.net; style-src 'unsafe-inline' ${origin}; connect-src https://esm.sh https://cdn.jsdelivr.net; img-src * data: blob:; font-src *;">
<title>${safeTitle}</title>
<script type="importmap">
{
  "imports": {
    "react": "${origin}/@hammies/react.mjs",
    "react-dom": "${origin}/@hammies/react-dom.mjs",
    "react-dom/client": "${origin}/@hammies/react-dom.mjs",
    "@hammies/frontend/components/ui": "${origin}/@hammies/artifact.mjs",
    "@hammies/frontend/lib/utils": "${origin}/@hammies/artifact.mjs"
  }
}
</script>
<script src="${origin}/@hammies/tailwindcss.js"></script>
<style type="text/tailwindcss">
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --font-sans: var(--font-sans);
  --font-mono: var(--font-mono);
}
@layer base {
  * { @apply border-border; }
  body { @apply text-foreground font-sans; }
}
</style>
<style>
body {
  font-size: 14px;
  padding: 1px;
}
</style>
<script>
// Sync CSS variables from parent document (live — updates on theme change)
(function syncThemeVars() {
  var VARS = ${THEME_VARS_JSON};
  function sync() {
    var parentStyle = window.parent.getComputedStyle(window.parent.document.documentElement);
    var root = document.documentElement;
    for (var i = 0; i < VARS.length; i++) {
      var val = parentStyle.getPropertyValue('--' + VARS[i]).trim();
      if (val) root.style.setProperty('--' + VARS[i], val);
    }
  }
  sync();
  var observer = new MutationObserver(sync);
  observer.observe(window.parent.document.documentElement, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('unload', function() { observer.disconnect(); });
})();
</script>
</head>
<body>
<div id="root"></div>
<script>
// postMessage bridge helpers
window.sendAction = function(intent, data) {
  var msg = { type: 'action', intent: String(intent) };
  if (data !== undefined) msg.data = data;
  window.parent.postMessage(msg, '*');
};
window.saveState = function(state) {
  window.parent.postMessage({ type: 'state', state: state }, '*');
};
window.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'restore' && typeof window.__onStateRestored === 'function') {
    window.__onStateRestored(e.data.state);
  }
});
// Forward horizontal scroll to parent so panel navigation works
document.addEventListener('wheel', function(e) {
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
    window.parent.postMessage({ type: 'wheel', deltaX: e.deltaX, deltaY: e.deltaY }, '*');
    e.preventDefault();
  }
}, { passive: false });
</script>
<script>
// Post errors to parent so they display in the red overlay
window.addEventListener('error', function(e) {
  window.parent.postMessage({ type: 'error', message: e.message || 'Unknown error' }, '*');
});
window.addEventListener('unhandledrejection', function(e) {
  var msg = (e.reason && e.reason.message) || String(e.reason) || 'Unhandled promise rejection';
  window.parent.postMessage({ type: 'error', message: msg }, '*');
});
</script>
<script type="module">
${safeCode}

// Mount the component
import { createRoot as _createRoot } from 'react-dom/client';
const _root = document.getElementById('root');
const _Component = typeof ${exportedName ? exportedName : "App"} !== 'undefined'
  ? ${exportedName || "App"}
  : null;

if (_Component) {
  _createRoot(_root).render(React.createElement(_Component));
} else {
  _root.textContent = 'No component found';
}

// Report content height to parent for inline auto-sizing.
// Temporarily override viewport-relative heights to measure intrinsic size.
(function() {
  var style = document.createElement('style');
  // Only override the outermost containers — leave component internals intact
  style.textContent = 'html, body { height: auto !important; min-height: 0 !important; overflow: visible !important; }';
  document.head.appendChild(style);
  function measure() {
    // Use body.scrollHeight — reflects natural content flow after overrides
    var h = document.body.scrollHeight;
    if (h > 0) window.parent.postMessage({ type: 'height', height: h }, '*');
    style.remove();
  }
  requestAnimationFrame(function() { requestAnimationFrame(measure); });
})();
</script>
</body>
</html>`
}
