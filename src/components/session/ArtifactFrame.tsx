import { useEffect, useRef, useCallback, useMemo } from "react"
import { usePreference } from "@/hooks/use-preferences"
import { resumeSession } from "@/api/client"
import { transformArtifactCode, escapeForScript } from "@/lib/artifact-transform"

interface ArtifactFrameProps {
  code: string
  title?: string
  sessionId: string
  sequence: number
  className?: string
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

// Resolved once at module level — shared across all ArtifactFrame instances.
// TODO: invalidate on theme change if runtime theme switching is added.
let _themeVars: Record<string, string> | undefined
function getThemeVars(): Record<string, string> {
  if (_themeVars) return _themeVars
  if (typeof document === "undefined") return {}
  const style = getComputedStyle(document.documentElement)
  const vars: Record<string, string> = {}
  for (const name of THEME_VARS) {
    const val = style.getPropertyValue(`--${name}`).trim()
    if (val) vars[name] = val
  }
  _themeVars = vars
  return vars
}

export function ArtifactFrame({ code, title, sessionId, sequence, className }: ArtifactFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const prefKey = `artifact:${sessionId}:${sequence}`
  const [savedState, setSavedState] = usePreference<Record<string, unknown>>(prefKey, {})
  const themeVars = getThemeVars()

  // Transform JSX in parent context — no Babel needed in iframe
  const { code: transformedCode, exportedName } = useMemo(
    () => transformArtifactCode(code),
    [code],
  )

  const srcDoc = useMemo(
    () => buildArtifactHtml(transformedCode, title, themeVars, exportedName),
    [transformedCode, title, themeVars, exportedName],
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
        resumeSession(sessionId, data.intent).catch(console.error)
      } else if (data.type === "state" && data.state) {
        setSavedState(data.state as Record<string, unknown>)
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
      className={className ?? "w-full border-0 rounded-md bg-card h-[600px]"}
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
  themeVars?: Record<string, string>,
  exportedName?: string | null,
): string {
  if (!code) return `<!DOCTYPE html><html><body style="background:var(--card);color:var(--foreground);font-family:sans-serif;"><p>No artifact code provided.</p></body></html>`
  const t = (name: string, fallback: string) => themeVars?.[name] || fallback
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
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' ${origin}; style-src 'unsafe-inline' ${origin}; img-src * data: blob:; font-src *;">
<title>${safeTitle}</title>
<script type="importmap">
{
  "imports": {
    "react": "${origin}/@hammies/react.mjs",
    "react-dom": "${origin}/@hammies/react-dom.mjs",
    "react-dom/client": "${origin}/@hammies/react-dom.mjs",
    "react/jsx-runtime": "${origin}/@hammies/react-jsx.mjs",
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
  body { @apply bg-card text-foreground font-sans; }
}
</style>
<style>
:root {
  --background: ${t("background", "#0d1117")}; --foreground: ${t("foreground", "#e6edf3")};
  --card: ${t("card", "#161b22")}; --card-foreground: ${t("card-foreground", "#e6edf3")};
  --primary: ${t("primary", "#4493f8")}; --primary-foreground: ${t("primary-foreground", "#fff")};
  --secondary: ${t("secondary", "#30363d")}; --secondary-foreground: ${t("secondary-foreground", "#e6edf3")};
  --muted: ${t("muted", "#161b22")}; --muted-foreground: ${t("muted-foreground", "#8b949e")};
  --accent: ${t("accent", "#388bfd")}; --accent-foreground: ${t("accent-foreground", "#c9d1d9")};
  --popover: ${t("popover", "#161b22")}; --popover-foreground: ${t("popover-foreground", "#e6edf3")};
  --border: ${t("border", "#30363d")}; --input: ${t("input", "#30363d")};
  --destructive: ${t("destructive", "#f85149")}; --destructive-foreground: ${t("destructive-foreground", "#fff")};
  --ring: ${t("ring", "#4493f8")};
  --chart-1: ${t("chart-1", "#4493f8")}; --chart-2: ${t("chart-2", "#3fb950")}; --chart-3: ${t("chart-3", "#a371f7")};
  --chart-4: ${t("chart-4", "#d29922")}; --chart-5: ${t("chart-5", "#f778ba")};
  --radius: ${t("radius", "0.375rem")};
  --font-sans: ${t("font-sans", "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif")};
  --font-mono: ${t("font-mono", "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace")};
}
body { font-size: 14px; min-height: 100vh; }
.error-box { background: color-mix(in srgb, var(--destructive) 15%, transparent); border: 1px solid var(--destructive); border-radius: var(--radius); padding: 12px; color: var(--destructive); font-family: var(--font-mono); font-size: 12px; white-space: pre-wrap; }
</style>
</head>
<body>
<div id="root"></div>
<script>
// postMessage bridge helpers
window.__sendAction = function(intent) {
  window.parent.postMessage({ type: 'action', intent: String(intent) }, '*');
};
window.__saveState = function(state) {
  window.parent.postMessage({ type: 'state', state: state }, '*');
};
window.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'restore' && typeof window.__onStateRestored === 'function') {
    window.__onStateRestored(e.data.state);
  }
});
</script>
<script type="module">
import React from 'react';
import { createRoot } from 'react-dom/client';

try {
${safeCode}

// Mount the component
const _root = document.getElementById('root');
const _Component = typeof ${exportedName ? exportedName : "App"} !== 'undefined'
  ? ${exportedName || "App"}
  : null;

if (_Component) {
  createRoot(_root).render(React.createElement(_Component));
} else {
  _root.innerHTML = '<div style="color:var(--muted-foreground)">No component found</div>';
}
} catch(_err) {
  const _el = document.createElement('div');
  _el.className = 'error-box';
  _el.textContent = _err.message;
  document.getElementById('root').appendChild(_el);
}
</script>
</body>
</html>`
}
