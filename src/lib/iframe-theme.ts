/**
 * Shared theme constants for all iframe contexts (HTML outputs, React artifacts,
 * plugin components, email bodies). Single source of truth for which CSS variables
 * and base styles are forwarded into sandboxed iframes.
 */

/** CSS custom property names forwarded from the app theme into iframes */
export const THEME_VARS = [
  // Colors
  "background", "foreground", "card", "card-foreground",
  "primary", "primary-foreground", "secondary", "secondary-foreground",
  "muted", "muted-foreground", "border", "input", "ring",
  "destructive", "destructive-foreground",
  "accent", "accent-foreground",
  "popover", "popover-foreground",
  "chart-1", "chart-2", "chart-3", "chart-4", "chart-5",
  // Layout
  "radius",
  // Typography
  "font-sans", "font-mono", "font-serif", "tracking-normal",
] as const

export const THEME_VARS_JSON = JSON.stringify(THEME_VARS)

/**
 * Base CSS applied to all iframe body elements.
 * Matches the app's Tailwind base layer: font-sans with line-height 1.5,
 * 14px font size, transparent background, border-color reset.
 */
export const IFRAME_BASE_CSS = `body{color:var(--foreground);background:transparent;font-family:var(--font-sans,ui-sans-serif,system-ui,sans-serif);font-size:14px;line-height:1.5;letter-spacing:var(--tracking-normal,0)}*,*::before,*::after{border-color:var(--border)}td{overflow-x:auto;scrollbar-width:none}td::-webkit-scrollbar{display:none}`

/** Inject a theme style block and a trailing script into raw HTML, respecting structure. */
export function injectIntoHtml(html: string, themeStyle: string, trailingScript: string): string {
  if (html.includes('</head>')) return html.replace('</head>', themeStyle + '</head>').replace('</body>', trailingScript + '</body>')
  const payload = themeStyle + trailingScript
  if (html.includes('</body>')) return html.replace('</body>', payload + '</body>')
  if (html.includes('</html>')) return html.replace('</html>', payload + '</html>')
  return html + payload
}
