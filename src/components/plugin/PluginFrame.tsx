import { useRef, useEffect, useCallback, useMemo } from "react"
import { buildPluginComponentHtml } from "@/lib/build-plugin-component-html"
import { useActiveTab, useNavActions } from "@/lib/navigation-store"
import { pluginIdFromTab } from "@/types/navigation"
import type { TabId } from "@/types/navigation"
import { createLogger } from "@/lib/logger"

const log = createLogger("plugin-frame")

interface PluginFrameProps {
  /** Plugin ID (e.g. "gmail", "notion-tasks") */
  pluginId: string
  /** Component name (e.g. "EmailTab", "TaskTab") — maps to app/components/{name}.tsx */
  componentName: string
  /** Props to pass to the component (serialized as JSON into the iframe) */
  componentProps?: Record<string, unknown>
  className?: string
}

/**
 * Sandboxed iframe that loads and renders a plugin component.
 *
 * Security model (same as ArtifactFrame):
 * - sandbox="allow-scripts allow-same-origin allow-popups"
 * - srcDoc gives the iframe a null origin (no cookies/localStorage access)
 * - CSP restricts connect-src to 'self' — plugin API calls go to same origin
 * - allow-same-origin lets the module script tag resolve the component URL
 *
 * postMessage bridge:
 * - navigate(path)        — switch tabs
 * - selectItem(id)        — open item detail panel
 * - pushPanel(panel)      — open session/editor panel
 * - sendAction(intent, d) — trigger session action
 * - saveState(state)      — persist UI state
 */
export function PluginFrame({
  pluginId,
  componentName,
  componentProps = {},
  className,
}: PluginFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const { switchTab, selectItem } = useNavActions()

  // Build srcDoc — rebuilt when pluginId, componentName, or props change
  const srcDoc = useMemo(() => {
    const origin = typeof window !== "undefined" ? window.location.origin : ""
    return buildPluginComponentHtml(pluginId, componentName, componentProps, origin)
  }, [pluginId, componentName, componentProps])

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      const iframe = iframeRef.current
      if (!iframe || event.source !== iframe.contentWindow) return

      const data = event.data
      if (!data || typeof data !== "object") return

      switch (data.type) {
        case "navigate":
          if (typeof data.path === "string") {
            // path is a tab ID like "plugin:gmail"
            switchTab(data.path as TabId)
          }
          break
        case "selectItem":
          if (typeof data.id === "string") {
            selectItem(data.id)
          }
          break
        case "pushPanel":
          // Panel push handled by navigation — future enhancement
          log.warn("pushPanel not yet implemented", { panel: data.panel })
          break
        case "height":
          // Auto-resize iframe to content height (capped at viewport height)
          if (iframe && typeof data.height === "number") {
            iframe.style.height = `${Math.min(data.height, window.innerHeight)}px`
          }
          break
        case "error":
          log.error("Plugin error", { pluginId, componentName, message: data.message })
          break
        default:
          break
      }
    },
    [pluginId, componentName, switchTab, selectItem],
  )

  useEffect(() => {
    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [handleMessage])

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcDoc}
      sandbox="allow-scripts allow-same-origin allow-popups"
      className={className ?? "w-full h-full border-0"}
      title={`${pluginId}/${componentName}`}
    />
  )
}

/**
 * PluginTab — renders a plugin's tab component via PluginFrame.
 * Wraps PluginFrame with the active tab context.
 */
export function PluginTab({ tabId }: { tabId?: TabId }) {
  const activeTab = useActiveTab()
  const resolvedTab = tabId ?? activeTab
  const pluginId = pluginIdFromTab(resolvedTab)

  if (!pluginId) return null

  return (
    <PluginFrame
      pluginId={pluginId}
      componentName="Tab"
      componentProps={{ tabId: resolvedTab }}
      className="w-full h-full border-0"
    />
  )
}
