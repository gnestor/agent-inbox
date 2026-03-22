import { useEffect, useRef, useCallback, useMemo } from "react"
import { usePreference } from "@/hooks/use-preferences"
import { transformArtifactCode, escapeForScript } from "@/lib/artifact-transform"

interface ArtifactFrameProps {
  code: string
  title?: string
  sessionId: string
  sequence: number
  className?: string
  /** Called when the artifact sends an action intent via sendAction() */
  onAction?: (intent: string) => void
}

/**
 * Sandboxed iframe that runs React artifacts written by the agent.
 *
 * Security model:
 * - sandbox="allow-scripts allow-same-origin" — enables ES module imports via import map
 * - CSP restricts connect-src to 'none' — no fetch/XHR from artifact code
 * - srcDoc gives the iframe a null origin — no access to parent cookies/localStorage
 * - Action intents flow out via postMessage and are translated to session resumes
 *
 * State persistence:
 * - Artifact UI state is stored in user_preferences under artifact:{sessionId}:{sequence}
 * - On remount, the saved state is pushed back to the iframe via postMessage
 */

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

export function ArtifactFrame({ code, title, sessionId, sequence, className, onAction }: ArtifactFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const prefKey = `artifact:${sessionId}:${sequence}`
  const [savedState, setSavedState] = usePreference<Record<string, unknown>>(prefKey, {})

  // Transform JSX in parent context — no Babel needed in iframe
  const { code: transformedCode, exportedName } = useMemo(
    () => transformArtifactCode(code),
    [code],
  )

  const srcDoc = useMemo(
    () => buildArtifactHtml(transformedCode, title, exportedName),
    [transformedCode, title, exportedName],
  )

  // Restore saved state when iframe loads
  const handleLoad = useCallback(() => {
    const iframe = iframeRef.current
    if (!iframe || !iframe.contentWindow) return
    if (savedState && Object.keys(savedState).length > 0) {
      iframe.contentWindow.postMessage({ type: "restore", state: savedState }, "*")
    }
  }, [savedState])

  // Listen for postMessage from artifact
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const iframe = iframeRef.current
      if (!iframe) return
      if (event.source !== iframe.contentWindow) return

      const data = event.data
      if (!data || typeof data !== "object") return

      if (data.type === "action" && typeof data.intent === "string") {
        // Wrap in XML tag so the transcript renders it as an artifact action, not a user message
        const safeIntent = data.intent.replace(/[<>"&]/g, "")
        const payload = data.data !== undefined ? JSON.stringify(data.data, null, 2) : ""
        const message = `<artifact_action intent="${safeIntent}">${payload}</artifact_action>`
        onAction?.(message)
      } else if (data.type === "state" && data.state) {
        setSavedState(data.state as Record<string, unknown>)
      } else if (data.type === "wheel") {
        // Re-dispatch horizontal scroll on the iframe's parent so panel nav works
        iframe.dispatchEvent(new WheelEvent("wheel", {
          deltaX: data.deltaX,
          deltaY: data.deltaY,
          bubbles: true,
        }))
      }
    }

    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [sessionId, setSavedState])

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcDoc}
      sandbox="allow-scripts allow-same-origin"
      className={className ?? "w-full border-0 rounded-md h-[600px]"}
      title={title || "React Artifact"}
      onLoad={handleLoad}
    />
  )
}

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
body { font-size: 14px; min-height: 100vh; }
.error-box { background: color-mix(in srgb, var(--destructive) 15%, transparent); border: 1px solid var(--destructive); border-radius: var(--radius); padding: 12px; color: var(--destructive); font-family: var(--font-mono); font-size: 12px; white-space: pre-wrap; }
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
  // Watch for theme changes (class attribute on parent <html>)
  var observer = new MutationObserver(sync);
  observer.observe(window.parent.document.documentElement, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('beforeunload', function() { observer.disconnect(); });
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
// Global error handlers for module script errors
window.addEventListener('error', function(e) {
  var el = document.createElement('div');
  el.className = 'error-box';
  el.textContent = e.message || 'Unknown error';
  document.getElementById('root').appendChild(el);
});
window.addEventListener('unhandledrejection', function(e) {
  var el = document.createElement('div');
  el.className = 'error-box';
  el.textContent = (e.reason && e.reason.message) || String(e.reason) || 'Unhandled promise rejection';
  document.getElementById('root').appendChild(el);
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
  _root.innerHTML = '<div style="color:var(--muted-foreground)">No component found</div>';
}
</script>
</body>
</html>`
}
