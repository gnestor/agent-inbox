import { useEffect, useRef, useCallback, useMemo } from "react"
import { usePreference } from "@/hooks/use-preferences"
import { resumeSession } from "@/api/client"

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
 * - sandbox="allow-scripts" only — no allow-same-origin
 * - The artifact has no access to the parent DOM, cookies, or localStorage
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
] as const

// Resolved once at module level — shared across all ArtifactFrame instances
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

  const srcDoc = useMemo(() => buildArtifactHtml(code, title, themeVars), [code, title, themeVars])

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
      sandbox="allow-scripts"
      className={className ?? "w-full border-0 rounded-md bg-card h-[600px]"}
      title={title || "React Artifact"}
      onLoad={handleLoad}
    />
  )
}

/**
 * Build an HTML document that loads Babel + React UMD and runs the artifact code.
 *
 * The artifact code is embedded as a JSON-encoded data attribute so no unsafe
 * string concatenation occurs inside a script block.
 */
export function buildArtifactHtml(code: string | undefined, title?: string, themeVars?: Record<string, string>): string {
  if (!code) return `<!DOCTYPE html><html><body style="background:var(--card);color:var(--foreground);font-family:sans-serif;"><p>No artifact code provided.</p></body></html>`
  // Resolve a theme variable with fallback
  const t = (name: string, fallback: string) => themeVars?.[name] || fallback
  const safeTitle = (title ?? "Artifact").replace(/[<>&"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c] ?? c)
  )
  // Encode code as base64 for safe embedding in a data attribute
  const codeAttr = btoa(unescape(encodeURIComponent(code)))

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${safeTitle}</title>
<script src="https://unpkg.com/@babel/standalone/babel.min.js" crossorigin="anonymous"></script>
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
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',
        destructive: { DEFAULT: 'var(--destructive)', foreground: 'var(--destructive-foreground)' },
      },
      borderColor: { DEFAULT: 'var(--border)' },
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
  --border: ${t("border", "#30363d")}; --input: ${t("input", "#30363d")};
  --destructive: ${t("destructive", "#f85149")}; --destructive-foreground: ${t("destructive-foreground", "#fff")};
  --ring: ${t("ring", "#4493f8")};
}
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 14px; background: var(--card); color: var(--foreground); min-height: 100vh; }
/* Style native form elements to match shadcn */
input, textarea, select { display: flex; width: 100%; border-radius: 0.375rem; border: 1px solid var(--input); background: var(--background); padding: 0.375rem 0.75rem; font-size: 0.875rem; line-height: 1.25rem; color: var(--foreground); outline: none; font-family: inherit; }
input:focus, textarea:focus, select:focus { border-color: var(--ring); box-shadow: 0 0 0 1px var(--ring); }
input::placeholder, textarea::placeholder { color: var(--muted-foreground); }
textarea { min-height: 5rem; resize: vertical; }
label { font-size: 0.875rem; font-weight: 500; line-height: 1; }
.error-box { background: #3c1111; border: 1px solid var(--destructive); border-radius: 6px; padding: 12px; color: #fca5a5; font-family: monospace; font-size: 12px; white-space: pre-wrap; }
</style>
</head>
<body>
<div id="root"></div>
<div id="artifact-code" data-code="${codeAttr}" style="display:none"></div>
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
  var userCode = decodeURIComponent(escape(atob(raw)));

  // Strip import/export statements — React & hooks are already global.
  // Only match lines that START with import/export keywords (anchored to line start)
  // to avoid mangling regex literals or strings that contain these words.
  var lines = userCode.split('\\n');
  var exportedName = null;
  var cleaned = [];
  for (var i = 0; i < lines.length; i++) {
    var trimmed = lines[i].trimStart();
    if (/^import\\s/.test(trimmed) && /from\\s+['\"]/.test(trimmed)) {
      continue; // import ... from '...'
    }
    if (/^import\\s+['\"]/.test(trimmed)) {
      continue; // import '...' (side-effect)
    }
    if (/^export\\s+default\\s+function\\s+(\\w+)/.test(trimmed)) {
      exportedName = trimmed.match(/^export\\s+default\\s+function\\s+(\\w+)/)[1];
      cleaned.push(trimmed.replace(/^export\\s+default\\s+/, ''));
    } else if (/^export\\s+default\\s+/.test(trimmed)) {
      exportedName = trimmed.replace(/^export\\s+default\\s+/, '').replace(/;\\s*$/, '').trim();
      continue; // standalone "export default ComponentName;"
    } else if (/^export\\s+/.test(trimmed)) {
      cleaned.push(trimmed.replace(/^export\\s+/, ''));
    } else {
      cleaned.push(lines[i]);
    }
  }
  userCode = cleaned.join('\\n');

  // Fix common LLM mistake: regex with literal newline (/\\n/g split across lines).
  // Replace /⏎/g patterns with /\\n/g so Babel can parse them.
  userCode = userCode.replace(/\\/\\n\\/([gimsuy]*)/g, '/\\\\n/$1');

  var stubs = [
    'const { useState, useEffect, useRef, useCallback, useMemo, useReducer, useContext, createContext } = React;',
    'function Button({ children, onClick, variant, className, disabled, size, ...p }) {',
    '  var base = "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";',
    '  var sizes = { sm: "h-8 px-3 text-xs", md: "h-9 px-4 py-2", lg: "h-10 px-6 text-base", icon: "h-9 w-9" };',
    '  var variants = {',
    '    primary: "bg-primary text-primary-foreground hover:bg-primary/90",',
    '    secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",',
    '    destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",',
    '    outline: "border border-border bg-transparent hover:bg-secondary hover:text-secondary-foreground",',
    '    ghost: "hover:bg-secondary hover:text-secondary-foreground",',
    '  };',
    '  var cls = base + " " + (sizes[size||"md"]||sizes.md) + " " + (variants[variant||"primary"]||variants.primary) + " " + (className||"");',
    '  return React.createElement("button", Object.assign({ className: cls, onClick: onClick, disabled: !!disabled }, p), children);',
    '}',
    'function Card({ children, className }) { return React.createElement("div", { className: "rounded-lg border bg-card text-card-foreground p-4 " + (className||"") }, children); }',
    'function Badge({ children, className, variant }) {',
    '  var v = { default: "bg-primary text-primary-foreground", secondary: "bg-secondary text-secondary-foreground", outline: "border border-border text-foreground" };',
    '  return React.createElement("span", { className: "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium " + (v[variant||"default"]||v.default) + " " + (className||"") }, children);',
    '}',
    'function Input(p) { var {className, ...rest} = p||{}; return React.createElement("input", Object.assign({ className: "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 " + (className||"") }, rest)); }',
    'function Textarea(p) { var {className, ...rest} = p||{}; return React.createElement("textarea", Object.assign({ className: "flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 " + (className||"") }, rest)); }',
    'function Label({ children, className, htmlFor }) { return React.createElement("label", { className: "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 " + (className||""), htmlFor: htmlFor }, children); }',
    'function Select(p) { var {className, children, ...rest} = p||{}; return React.createElement("select", Object.assign({ className: "flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 " + (className||"") }, rest), children); }',
    'function Separator({ className, orientation }) { return React.createElement("div", { className: "shrink-0 bg-border " + (orientation === "vertical" ? "h-full w-[1px]" : "h-[1px] w-full") + " " + (className||"") }); }',
    'function Switch({ checked, onCheckedChange, className }) {',
    '  return React.createElement("button", { type: "button", role: "switch", "aria-checked": !!checked, onClick: function() { onCheckedChange && onCheckedChange(!checked); },',
    '    className: "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors " + (checked ? "bg-primary" : "bg-secondary") + " " + (className||"") },',
    '    React.createElement("span", { className: "pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform " + (checked ? "translate-x-4" : "translate-x-0") }));',
    '}',
  ].join('\\n');

  try {
    var transpiled = Babel.transform(stubs + '\\n' + userCode, {
      presets: ['react']
    }).code;

    // indirect eval so the transpiled code runs in the iframe's scope
    (0, eval)(transpiled);

    // Find the component to render: use exported name, or detect any PascalCase function
    var RootComponent = null;
    if (exportedName && typeof eval(exportedName) !== 'undefined') {
      RootComponent = eval(exportedName);
    } else if (typeof App !== 'undefined') {
      RootComponent = App;
    } else {
      // Scan for any PascalCase component defined in the code
      var componentMatch = userCode.match(/function\\s+([A-Z]\\w*)\\s*\\(/);
      if (componentMatch && typeof eval(componentMatch[1]) !== 'undefined') {
        RootComponent = eval(componentMatch[1]);
      }
    }

    if (RootComponent) {
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(RootComponent));
    } else {
      var fallback = document.createElement('div');
      fallback.style.color = '#71717a';
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
