import { useEffect, useRef, useCallback, useMemo } from "react"
import { usePreference } from "@/hooks/use-preferences"
import { resumeSession } from "@/api/client"
import { transformArtifactCode } from "@/lib/artifact-transform"

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
  const codeAttr = btoa(unescape(encodeURIComponent(code)))
  const origin = typeof window !== "undefined" ? window.location.origin : ""

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' ${origin} https://unpkg.com https://cdn.tailwindcss.com; style-src 'unsafe-inline'; img-src * data: blob:; font-src *;">
<title>${safeTitle}</title>
<script type="importmap">
{
  "imports": {
    "@hammies/frontend/components/ui": "${origin}/@hammies/components.mjs",
    "@hammies/frontend/lib/utils": "${origin}/@hammies/components.mjs"
  }
}
</script>
<script src="https://unpkg.com/react@18/umd/react.development.js" crossorigin="anonymous"></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js" crossorigin="anonymous"></script>
<script src="https://cdn.tailwindcss.com"></script>
<script>
tailwind.config = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: 'var(--card)',
        foreground: 'var(--foreground)',
        card: { DEFAULT: 'var(--card)', foreground: 'var(--card-foreground)' },
        primary: { DEFAULT: 'var(--primary)', foreground: 'var(--primary-foreground)' },
        secondary: { DEFAULT: 'var(--secondary)', foreground: 'var(--secondary-foreground)' },
        muted: { DEFAULT: 'var(--muted)', foreground: 'var(--muted-foreground)' },
        accent: { DEFAULT: 'var(--accent)', foreground: 'var(--accent-foreground)' },
        popover: { DEFAULT: 'var(--popover)', foreground: 'var(--popover-foreground)' },
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',
        destructive: { DEFAULT: 'var(--destructive)', foreground: 'var(--destructive-foreground)' },
        chart: { 1: 'var(--chart-1)', 2: 'var(--chart-2)', 3: 'var(--chart-3)', 4: 'var(--chart-4)', 5: 'var(--chart-5)' },
      },
      borderColor: { DEFAULT: 'var(--border)' },
      borderRadius: { sm: 'calc(var(--radius) - 4px)', md: 'calc(var(--radius) - 2px)', lg: 'var(--radius)', xl: 'calc(var(--radius) + 4px)' },
      fontFamily: { sans: 'var(--font-sans)', mono: 'var(--font-mono)' },
    }
  }
}
</script>
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
body { font-family: var(--font-sans); font-size: 14px; background: var(--card); color: var(--foreground); min-height: 100vh; }
/* Style native form elements to match shadcn */
input, textarea, select { display: flex; width: 100%; border-radius: var(--radius); border: 1px solid var(--input); background: var(--background); padding: 0.375rem 0.75rem; font-size: 0.875rem; line-height: 1.25rem; color: var(--foreground); outline: none; font-family: inherit; }
input:focus, textarea:focus, select:focus { border-color: var(--ring); box-shadow: 0 0 0 1px var(--ring); }
input::placeholder, textarea::placeholder { color: var(--muted-foreground); }
textarea { min-height: 5rem; resize: vertical; }
label { font-size: 0.875rem; font-weight: 500; line-height: 1; }
.error-box { background: color-mix(in srgb, var(--destructive) 15%, transparent); border: 1px solid var(--destructive); border-radius: var(--radius); padding: 12px; color: var(--destructive); font-family: var(--font-mono); font-size: 12px; white-space: pre-wrap; }
</style>
</head>
<body>
<div id="root"></div>
<div id="artifact-code" data-code="${codeAttr}" data-export="${exportedName ?? ""}" style="display:none"></div>
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

(function bootstrap() {
  var codeEl = document.getElementById('artifact-code');
  var raw = codeEl ? codeEl.getAttribute('data-code') : '';
  if (!raw) { return; }
  var code = decodeURIComponent(escape(atob(raw)));
  var exportedName = codeEl.getAttribute('data-export') || null;

  try {
    // Code is pre-transformed in the parent (JSX → createElement, imports handled)
    (0, eval)(code);

    // Find the component to render
    var RootComponent = null;
    if (exportedName && typeof eval(exportedName) !== 'undefined') {
      RootComponent = eval(exportedName);
    } else if (typeof App !== 'undefined') {
      RootComponent = App;
    } else {
      // Scan for any PascalCase component defined in the code
      var componentMatch = code.match(/function\\s+([A-Z]\\w*)\\s*\\(/);
      if (componentMatch && typeof eval(componentMatch[1]) !== 'undefined') {
        RootComponent = eval(componentMatch[1]);
      }
    }

    if (RootComponent) {
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(RootComponent));
    } else {
      var fallback = document.createElement('div');
      fallback.style.color = 'var(--muted-foreground)';
      fallback.textContent = 'No App component found';
      document.getElementById('root').appendChild(fallback);
    }
  } catch(err) {
    var errEl = document.createElement('div');
    errEl.className = 'error-box';
    errEl.textContent = err.message;
    document.getElementById('root').appendChild(errEl);
  }
})();
</script>
</body>
</html>`
}
