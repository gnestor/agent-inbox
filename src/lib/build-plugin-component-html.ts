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
 * Build an HTML document for a plugin component iframe.
 *
 * The component is loaded via a module script tag pointing to the server's
 * esbuild-transform route (/api/:pluginId/components/:name). The iframe uses
 * allow-same-origin so module resolution works, but srcDoc gives it a null
 * origin preventing access to parent cookies/localStorage.
 *
 * postMessage bridge:
 *   window.navigate(path)        — switch tabs in the parent
 *   window.selectItem(id)        — open an item's detail panel
 *   window.pushPanel(panel)      — open a session/editor panel
 *   window.getPluginId()         — returns the pluginId string
 *   window.sendAction(intent, d) — trigger a session action
 *   window.saveState(state)      — persist UI state
 *   window.__onStateRestored     — called by parent to restore state
 */
export function buildPluginComponentHtml(
  pluginId: string,
  componentName: string,
  componentProps: Record<string, unknown>,
  origin: string,
): string {
  const componentUrl = `${origin}/api/${pluginId}/components/${componentName}`
  const propsJson = JSON.stringify(componentProps).replace(/</g, "\\u003c")

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' ${origin}; style-src 'unsafe-inline' ${origin}; connect-src 'self'; img-src * data: blob:; font-src *;">
<title>${pluginId}/${componentName}</title>
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
  margin: 0;
  overflow: hidden;
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

// postMessage bridge helpers (global functions available in plugin components)
window.navigate = function(path) {
  window.parent.postMessage({ type: 'navigate', path: String(path) }, '*');
};
window.selectItem = function(id) {
  window.parent.postMessage({ type: 'selectItem', id: String(id) }, '*');
};
window.pushPanel = function(panel) {
  window.parent.postMessage({ type: 'pushPanel', panel: panel }, '*');
};
window.getPluginId = function() {
  return ${JSON.stringify(pluginId)};
};
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
  if (e.data && e.data.type === 'theme') {
    var root = document.documentElement;
    var vars = e.data.vars;
    for (var k in vars) root.style.setProperty('--' + k, vars[k]);
  }
});

// Error reporting
window.addEventListener('error', function(e) {
  window.parent.postMessage({ type: 'error', message: e.message || 'Unknown error' }, '*');
});
window.addEventListener('unhandledrejection', function(e) {
  var msg = (e.reason && e.reason.message) || String(e.reason) || 'Unhandled promise rejection';
  window.parent.postMessage({ type: 'error', message: msg }, '*');
});

// Height reporting
window.__reportHeight = function() {
  requestAnimationFrame(function() { requestAnimationFrame(function() {
    var h = document.documentElement.scrollHeight;
    if (h > 0) window.parent.postMessage({ type: 'height', height: h }, '*');
  }); });
};
</script>
</head>
<body>
<div id="root"></div>
<script type="module">
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import Component from '${componentUrl}';

const props = ${propsJson};
const root = createRoot(document.getElementById('root'));
root.render(createElement(Component, props));
window.__reportHeight();
</script>
</body>
</html>`
}
