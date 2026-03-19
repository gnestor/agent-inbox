import { useEffect, useRef, useCallback, useMemo } from "react"
import { usePreference } from "@/hooks/use-preferences"
import { resumeSession } from "@/api/client"

interface ArtifactFrameProps {
  code: string
  title?: string
  sessionId: string
  sequence: number
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
export function ArtifactFrame({ code, title, sessionId, sequence }: ArtifactFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const prefKey = `artifact:${sessionId}:${sequence}`
  const [savedState, setSavedState] = usePreference<Record<string, unknown>>(prefKey, {})

  const srcDoc = useMemo(() => buildArtifactHtml(code, title), [code, title])

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
      className="w-full border-0 rounded-md bg-background"
      style={{ height: "400px" }}
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
export function buildArtifactHtml(code: string, title?: string): string {
  const safeTitle = (title ?? "Artifact").replace(/[<>&"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c] ?? c)
  )
  // Encode code as JSON for safe embedding in a data attribute
  const codeAttr = JSON.stringify(code).replace(/"/g, "&quot;")

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${safeTitle}</title>
<script src="https://unpkg.com/@babel/standalone/babel.min.js" crossorigin="anonymous"></script>
<script src="https://unpkg.com/react@18/umd/react.development.js" crossorigin="anonymous"></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js" crossorigin="anonymous"></script>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 14px; background: #09090b; color: #fafafa; padding: 16px; min-height: 100vh; }
.btn { display: inline-flex; align-items: center; justify-content: center; border-radius: 6px; font-size: 14px; font-weight: 500; padding: 8px 16px; cursor: pointer; border: none; transition: opacity 0.15s; }
.btn:hover { opacity: 0.9; }
.btn-primary { background: #fafafa; color: #09090b; }
.btn-secondary { background: #27272a; color: #fafafa; }
.btn-destructive { background: #ef4444; color: #fafafa; }
.card { border-radius: 8px; border: 1px solid #27272a; background: #18181b; padding: 16px; }
.badge { display: inline-flex; align-items: center; border-radius: 9999px; font-size: 12px; padding: 2px 10px; font-weight: 500; }
input, textarea, select { background: #18181b; border: 1px solid #27272a; border-radius: 6px; color: #fafafa; padding: 8px 12px; font-size: 14px; outline: none; width: 100%; }
input:focus, textarea:focus { border-color: #71717a; }
.error-box { background: #450a0a; border: 1px solid #ef4444; border-radius: 6px; padding: 12px; color: #fca5a5; font-family: monospace; font-size: 12px; white-space: pre-wrap; }
</style>
</head>
<body>
<div id="root"></div>
<div id="artifact-code" data-code=${codeAttr} style="display:none"></div>
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
  var userCode = codeEl ? codeEl.getAttribute('data-code') : '';
  if (!userCode) { return; }

  var stubs = [
    'const { useState, useEffect, useRef, useCallback, useMemo } = React;',
    'function Button({ children, onClick, variant, className, disabled, ...p }) {',
    '  return React.createElement("button", Object.assign({ className: "btn btn-" + (variant||"primary") + " " + (className||""), onClick: onClick, disabled: !!disabled }, p), children);',
    '}',
    'function Card({ children, className }) { return React.createElement("div", { className: "card " + (className||"") }, children); }',
    'function Badge({ children, className }) { return React.createElement("span", { className: "badge " + (className||"") }, children); }',
  ].join('\\n');

  try {
    var transpiled = Babel.transform(stubs + '\\n' + userCode, {
      presets: ['react', ['env', { targets: { chrome: 80 } }]]
    }).code;

    // indirect eval so the transpiled code runs in the iframe's scope
    (0, eval)(transpiled);

    if (typeof App !== 'undefined') {
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
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
