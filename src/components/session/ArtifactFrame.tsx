import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { usePreference } from "@/hooks/use-preferences"
import { transformArtifactCode } from "@/lib/artifact-transform"
import { buildArtifactHtml } from "@/lib/build-artifact-html"

// Cache srcDoc HTML per artifact so revisits don't rebuild/reload iframes
const srcDocCache = new Map<string, string>()

interface ArtifactFrameProps {
  code: string
  title?: string
  sessionId: string
  sequence: number
  className?: string
  /** Called when the artifact sends an action intent via sendAction() */
  onAction?: (intent: string) => void
  /** Called when the artifact iframe reports its content height (fully loaded) */
  onHeightReported?: () => void
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

export function ArtifactFrame({ code, title, sessionId, sequence, className, onAction, onHeightReported }: ArtifactFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const prefKey = `artifact:${sessionId}:${sequence}`
  const [savedState, setSavedState] = usePreference<Record<string, unknown>>(prefKey, {})

  // Transform JSX in parent context — no Babel needed in iframe.
  // Keep last valid result so syntax errors during editing don't crash the app.
  const lastValidRef = useRef<{ code: string; exportedName: string | null } | null>(null)
  const transformResult = useMemo(() => {
    try {
      return { ...transformArtifactCode(code), error: null as string | null }
    } catch (e) {
      const prev = lastValidRef.current
      return {
        code: prev?.code ?? "",
        exportedName: prev?.exportedName ?? null,
        error: e instanceof Error ? e.message : String(e),
      }
    }
  }, [code])
  // Update last valid ref outside useMemo to keep it pure
  useEffect(() => {
    if (!transformResult.error) lastValidRef.current = transformResult
  }, [transformResult])
  const { code: transformedCode, exportedName, error: transformError } = transformResult

  const srcDoc = useMemo(() => {
    const cacheKey = `${sessionId}:${sequence}:${transformedCode}`
    const cached = srcDocCache.get(cacheKey)
    if (cached && !transformError) return cached
    // Evict previous entries for this artifact (different code)
    const prefix = `${sessionId}:${sequence}:`
    for (const key of srcDocCache.keys()) {
      if (key.startsWith(prefix)) srcDocCache.delete(key)
    }
    const html = buildArtifactHtml(transformedCode, title, exportedName)
    if (!transformError) srcDocCache.set(cacheKey, html)
    return html
  }, [transformedCode, title, exportedName, sessionId, sequence, transformError])

  const handleLoad = useCallback(() => {
    const iframe = iframeRef.current
    if (!iframe || !iframe.contentWindow) return
    if (savedState && Object.keys(savedState).length > 0) {
      iframe.contentWindow.postMessage({ type: "restore", state: savedState }, "*")
    }
  }, [savedState])

  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const [contentHeight, setContentHeight] = useState<number | null>(null)
  useEffect(() => setRuntimeError(null), [code])

  // Listen for postMessage from artifact
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const iframe = iframeRef.current
      if (!iframe) return
      if (event.source !== iframe.contentWindow) return

      const data = event.data
      if (!data || typeof data !== "object") return

      if (data.type === "action" && typeof data.intent === "string") {
        const safeIntent = data.intent.replace(/[<>"&]/g, "")
        const payload = data.data !== undefined ? JSON.stringify(data.data, null, 2) : ""
        const message = `<artifact_action intent="${safeIntent}">${payload}</artifact_action>`
        onAction?.(message)
      } else if (data.type === "state" && data.state) {
        setSavedState(data.state as Record<string, unknown>)
      } else if (data.type === "error" && typeof data.message === "string") {
        setRuntimeError(data.message)
      } else if (data.type === "height" && typeof data.height === "number") {
        setContentHeight(data.height)
        onHeightReported?.()
      } else if (data.type === "wheel") {
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
    <div className="relative w-full h-full">
      <iframe
        ref={iframeRef}
        srcDoc={srcDoc}
        sandbox="allow-scripts allow-same-origin"
        className={className ?? "w-full border-0 rounded-md"}
        style={!className ? { height: contentHeight != null ? Math.min(contentHeight, 600) : 600 } : undefined}
        title={title || "React Artifact"}
        onLoad={handleLoad}
      />
      {(transformError || runtimeError) && (
        <div className="absolute inset-0 bg-destructive p-4 overflow-auto">
          <pre className="text-white text-xs font-mono whitespace-pre-wrap">{transformError || runtimeError}</pre>
        </div>
      )}
    </div>
  )
}
