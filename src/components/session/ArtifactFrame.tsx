import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { usePreference } from "@/hooks/use-preferences"
import { transformArtifactCode } from "@hammies/frontend/lib/artifact-transform"
import { buildArtifactHtml } from "@hammies/frontend/lib/build-artifact-html"
import { Skeleton } from "@hammies/frontend/components/ui"
import {
  ArtifactToHostMessageSchema,
  CONTRACT_VERSION,
  decodeIframeMessage,
} from "@hammies/contracts/iframe"
import { formatContractReport } from "@hammies/contracts"
import { createLogger } from "@/lib/logger"

const log = createLogger("artifact-frame")

// Cache srcDoc HTML per artifact so revisits don't rebuild/reload iframes.
// Capped to prevent unbounded growth in long sessions.
const srcDocCache = new Map<string, string>()
const SRCDOC_CACHE_MAX = 50
// Cache reported content heights so remounts start at the correct size
// instead of flashing the default height before the iframe postMessage arrives.
// Capped at 500 entries to prevent unbounded growth.
const artifactHeightCache = new Map<string, number>()
const ARTIFACT_HEIGHT_CACHE_MAX = 500

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
 * - sandbox="allow-scripts allow-same-origin allow-popups allow-downloads" — allow-same-origin
 *   enables ES module imports via import map; allow-downloads lets an artifact offer a file.
 *   Without it Chrome refuses every download from here ("the frame initiating or instantiating
 *   the download is sandboxed"), and says so only in the console — so a download button simply
 *   does nothing, with nothing to tell the agent why.
 * - CSP restricts connect-src to the host origin — see build-artifact-html.ts
 * - With allow-same-origin the srcDoc iframe INHERITS the host origin: the sandbox attribute is
 *   not a boundary against the parent, and same-origin requests carry the session cookie. Treat
 *   artifact code as running with the signed-in user's authority; the connect-src allowlist is
 *   the real containment. (This block used to claim a null origin and no cookie access — both
 *   were wrong, and the spec was corrected in 2026-07 while this comment was not.)
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

  // Transform JSX → React.createElement via React Query.
  // Babel is loaded lazily on first artifact render; results are cached by code string.
  const lastValidRef = useRef<{ code: string; exportedName: string | null } | null>(null)
  const { data: transformResult, isLoading: transformLoading, error: transformQueryError } = useQuery({
    queryKey: ["artifact-transform", code],
    queryFn: () => transformArtifactCode(code),
    staleTime: Infinity,
    gcTime: 10 * 60 * 1000,
    retry: false,
  })

  // Track last valid result so syntax errors during editing show the previous good version
  if (transformResult) lastValidRef.current = transformResult
  const transformedCode = transformResult?.code ?? lastValidRef.current?.code ?? ""
  const exportedName = transformResult?.exportedName ?? lastValidRef.current?.exportedName ?? null
  const transformError = transformQueryError instanceof Error ? transformQueryError.message : transformQueryError ? String(transformQueryError) : null

  const srcDoc = useMemo(() => {
    // Don't build HTML until the transform has produced code
    if (transformLoading && !transformedCode) return ""
    const cacheKey = `${sessionId}:${sequence}:${transformedCode}`
    const cached = srcDocCache.get(cacheKey)
    if (cached && !transformError) return cached
    const prefix = `${sessionId}:${sequence}:`
    for (const key of srcDocCache.keys()) {
      if (key.startsWith(prefix)) srcDocCache.delete(key)
    }
    const html = buildArtifactHtml(transformedCode, { title, exportedName, transformError })
    if (!transformError) {
      if (srcDocCache.size >= SRCDOC_CACHE_MAX) {
        const first = srcDocCache.keys().next().value
        if (first) srcDocCache.delete(first)
      }
      srcDocCache.set(cacheKey, html)
    }
    return html
  }, [transformedCode, title, exportedName, sessionId, sequence, transformError, transformLoading])

  const handleLoad = useCallback(() => {
    const iframe = iframeRef.current
    if (!iframe || !iframe.contentWindow) return
    if (savedState && Object.keys(savedState).length > 0) {
      iframe.contentWindow.postMessage(
        { contractVersion: CONTRACT_VERSION, type: "restore", state: savedState },
        window.location.origin,
      )
    }
  }, [savedState])

  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const heightKey = `${sessionId}:${sequence}`
  // Use cached height for SIZING (avoids layout shift) but track whether this
  // mount has received a live postMessage for VISIBILITY (avoids blank flash).
  const cachedHeight = artifactHeightCache.get(heightKey)
  const [contentHeight, setContentHeight] = useState<number | null>(cachedHeight ?? null)
  const [heightReported, setHeightReported] = useState(false)
  useEffect(() => setRuntimeError(null), [code])

  // Listen for postMessage from artifact
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const iframe = iframeRef.current
      if (!iframe?.contentWindow) return
      const decoded = decodeIframeMessage(
        event,
        { source: iframe.contentWindow, origin: window.location.origin },
        ArtifactToHostMessageSchema,
        "artifact-to-host@1",
        (error) => log.error(formatContractReport(error, "artifact frame message")),
      )
      if (!decoded.ok) return
      const data = decoded.value

      if (data.type === "action") {
        const safeIntent = data.intent.replace(/[<>"&]/g, "")
        const payload = data.data !== undefined ? JSON.stringify(data.data, null, 2) : ""
        const message = `<artifact_action intent="${safeIntent}">${payload}</artifact_action>`
        onAction?.(message)
      } else if (data.type === "state") {
        setSavedState(data.state)
      } else if (data.type === "error") {
        setRuntimeError(data.message)
      } else if (data.type === "height") {
        artifactHeightCache.set(heightKey, data.height)
        if (artifactHeightCache.size > ARTIFACT_HEIGHT_CACHE_MAX) {
          const first = artifactHeightCache.keys().next().value
          if (first) artifactHeightCache.delete(first)
        }
        setContentHeight(data.height)
        setHeightReported(true)
        onHeightReported?.()
      } else if (
        data.type === "wheel" &&
        typeof data.deltaX === "number" &&
        typeof data.deltaY === "number"
      ) {
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

  // Use cached height for sizing (avoids layout shift), live report for visibility
  const hasHeight = contentHeight != null
  const iframeHeight = hasHeight ? Math.min(contentHeight, 600) : 200
  const showIframe = heightReported

  // Render compile/runtime errors in flow so they don't overlap transcript content below.
  if (transformError || runtimeError) {
    return (
      <div className={className ?? "w-full"}>
        <div className="bg-destructive p-4 rounded-md overflow-auto">
          <pre className="text-white text-xs font-mono whitespace-pre-wrap">{transformError || runtimeError}</pre>
        </div>
      </div>
    )
  }

  return (
    <div className="relative w-full h-full">
      {/* Don't render iframe until Babel has transformed the code and produced srcDoc */}
      {!transformLoading && srcDoc && (
        <iframe
          ref={iframeRef}
          srcDoc={srcDoc}
          sandbox="allow-scripts allow-same-origin allow-popups allow-downloads"
          className={className ?? `w-full border-0 rounded-md ${showIframe ? "" : "opacity-0 absolute inset-0"}`}
          style={!className ? { height: iframeHeight } : undefined}
          title={title || "React Artifact"}
          onLoad={handleLoad}
        />
      )}
      {(!showIframe || transformLoading) && (
        <Skeleton
          className={className ? "w-full h-full rounded-md" : "w-full rounded-md"}
          style={className ? undefined : { height: iframeHeight }}
        />
      )}
    </div>
  )
}
