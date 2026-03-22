import { useRef, useEffect } from "react"

const EMAIL_THEME_VARS = ["foreground", "card", "font-sans", "font-mono"] as const

/**
 * Manages iframe auto-height by observing the iframe body's scroll height
 * via load events and ResizeObserver. Also syncs theme CSS variables from
 * the parent document into the iframe and updates on theme changes.
 */
export function useIframeAutoHeight(srcDoc: string) {
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return

    function syncTheme() {
      const doc = iframe!.contentDocument
      if (!doc) return
      const parentStyle = getComputedStyle(document.documentElement)
      const root = doc.documentElement
      for (const name of EMAIL_THEME_VARS) {
        const val = parentStyle.getPropertyValue(`--${name}`).trim()
        if (val) root.style.setProperty(`--${name}`, val)
      }
      const isDark = document.documentElement.classList.contains("dark")
      root.style.colorScheme = isDark ? "dark" : "light"
    }

    function syncHeight() {
      const body = iframe!.contentDocument?.body
      if (body) iframe!.style.height = body.scrollHeight + "px"
    }

    let ro: ResizeObserver | undefined
    let observer: MutationObserver | undefined

    function onLoad() {
      syncTheme()
      syncHeight()
      const body = iframe!.contentDocument?.body
      if (body) {
        ro = new ResizeObserver(syncHeight)
        ro.observe(body)
      }
    }
    iframe.addEventListener("load", onLoad)

    // Watch for theme changes (class attribute on parent <html>)
    observer = new MutationObserver(syncTheme)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })

    return () => {
      iframe.removeEventListener("load", onLoad)
      ro?.disconnect()
      observer?.disconnect()
    }
  }, [srcDoc])

  return { iframeRef }
}
