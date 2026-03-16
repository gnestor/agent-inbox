import { Link } from "lucide-react"

// SVG file imports (Vite resolves to URLs)
import airSvg from "@/assets/icons/air.svg"
import githubSvg from "@/assets/icons/github.svg"
import googleSvg from "@/assets/icons/google.svg"
import gorgeousSvg from "@/assets/icons/gorgias.svg"
import happyReturnsSvg from "@/assets/icons/happy-returns.svg"
import instagramSvg from "@/assets/icons/instagram.svg"
import klaviyoSvg from "@/assets/icons/klaviyo.svg"
import notionSvg from "@/assets/icons/notion.svg"
import pinterestSvg from "@/assets/icons/pinterest.svg"
import shippoSvg from "@/assets/icons/shippo.svg"
import shopifySvg from "@/assets/icons/shopify.svg"
import slackSvg from "@/assets/icons/slack.svg"
import googleAdsSvg from "@/assets/icons/google-ads.svg"

// Simple Icons — QuickBooks
function QuickBooksIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20">
      <path fill="#2CA01C" d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm.642 4.1335c.9554 0 1.7296.776 1.7296 1.7332v9.0667h1.6c1.614 0 2.9275-1.3156 2.9275-2.933 0-1.6173-1.3136-2.9333-2.9276-2.9333h-.6654V7.3334h.6654c2.5722 0 4.6577 2.0897 4.6577 4.667 0 2.5774-2.0855 4.6666-4.6577 4.6666H12.642zM7.9837 7.333h3.3291v12.533c-.9555 0-1.73-.7759-1.73-1.7332V9.0662H7.9837c-1.6146 0-2.9277 1.316-2.9277 2.9334 0 1.6175 1.3131 2.9333 2.9277 2.9333h.6654v1.7332h-.6654c-2.5725 0-4.6577-2.0892-4.6577-4.6665 0-2.5771 2.0852-4.6666 4.6577-4.6666Z" />
    </svg>
  )
}

// Simple Icons — Meta
function MetaIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20">
      <path fill="#0081FB" d="M6.915 4.03c-1.968 0-3.683 1.28-4.871 3.113C.704 9.208 0 11.883 0 14.449c0 .706.07 1.369.21 1.973a6.624 6.624 0 0 0 .265.86 5.297 5.297 0 0 0 .371.761c.696 1.159 1.818 1.927 3.593 1.927 1.497 0 2.633-.671 3.965-2.444.76-1.012 1.144-1.626 2.663-4.32l.756-1.339.186-.325c.061.1.121.196.183.3l2.152 3.595c.724 1.21 1.665 2.556 2.47 3.314 1.046.987 1.992 1.22 3.06 1.22 1.075 0 1.876-.355 2.455-.843a3.743 3.743 0 0 0 .81-.973c.542-.939.861-2.127.861-3.745 0-2.72-.681-5.357-2.084-7.45-1.282-1.912-2.957-2.93-4.716-2.93-1.047 0-2.088.467-3.053 1.308-.652.57-1.257 1.29-1.82 2.05-.69-.875-1.335-1.547-1.958-2.056-1.182-.966-2.315-1.303-3.454-1.303zm10.16 2.053c1.147 0 2.188.758 2.992 1.999 1.132 1.748 1.647 4.195 1.647 6.4 0 1.548-.368 2.9-1.839 2.9-.58 0-1.027-.23-1.664-1.004-.496-.601-1.343-1.878-2.832-4.358l-.617-1.028a44.908 44.908 0 0 0-1.255-1.98c.07-.109.141-.224.211-.327 1.12-1.667 2.118-2.602 3.358-2.602zm-10.201.553c1.265 0 2.058.791 2.675 1.446.307.327.737.871 1.234 1.579l-1.02 1.566c-.757 1.163-1.882 3.017-2.837 4.338-1.191 1.649-1.81 1.817-2.486 1.817-.524 0-1.038-.237-1.383-.794-.263-.426-.464-1.13-.464-2.046 0-2.221.63-4.535 1.66-6.088.454-.687.964-1.226 1.533-1.533a2.264 2.264 0 0 1 1.088-.285z" />
    </svg>
  )
}

// Simple Icons — Facebook
function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20">
      <path fill="#1877F2" d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  )
}

// Simple Icons — Observable
function ObservableIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20">
      <path fill="currentColor" d="M12 20c-1.065 0-1.988-.232-2.77-.696a4.7 4.7 0 0 1-1.794-1.89 9.97 9.97 0 0 1-.916-2.53A13.613 13.613 0 0 1 6.23 12c0-.766.05-1.499.152-2.2.1-.699.285-1.41.556-2.132A6.803 6.803 0 0 1 7.98 5.79a4.725 4.725 0 0 1 1.668-1.293C10.337 4.165 11.12 4 12 4c1.065 0 1.988.232 2.77.696a4.7 4.7 0 0 1 1.794 1.89c.418.795.723 1.639.916 2.53.192.891.29 1.853.29 2.884 0 .766-.05 1.499-.152 2.2a9.812 9.812 0 0 1-.567 2.132 7.226 7.226 0 0 1-1.042 1.878c-.418.53-.97.962-1.657 1.293-.688.332-1.471.497-2.352.497zm2.037-5.882c.551-.554.858-1.32.848-2.118 0-.824-.276-1.53-.827-2.118C13.506 9.294 12.82 9 12 9c-.82 0-1.506.294-2.058.882A2.987 2.987 0 0 0 9.115 12c0 .824.276 1.53.827 2.118.552.588 1.238.882 2.058.882.82 0 1.5-.294 2.037-.882zM12 24c6.372 0 11.538-5.373 11.538-12S18.372 0 12 0 .462 5.373.462 12 5.628 24 12 24Z" />
    </svg>
  )
}

// Icons that are black/dark on transparent — invert in dark mode
const monochromeIcons = new Set(["air", "gorgias", "klaviyo", "notion", "github", "observable"])

// SVG file-based icons (from brandfetch)
const svgFileIcons: Record<string, string> = {
  air: airSvg,
  github: githubSvg,
  google: googleSvg,
  gorgias: gorgeousSvg,
  "happy-returns": happyReturnsSvg,
  instagram: instagramSvg,
  klaviyo: klaviyoSvg,
  notion: notionSvg,
  pinterest: pinterestSvg,
  shippo: shippoSvg,
  shopify: shopifySvg,
  slack: slackSvg,
  "google-ads": googleAdsSvg,
}

// Inline SVG components (from Simple Icons)
const inlineIcons: Record<string, React.FC> = {
  quickbooks: QuickBooksIcon,
  meta: MetaIcon,
  facebook: FacebookIcon,
  observable: ObservableIcon,
}

export function IntegrationIcon({
  integrationId,
  className,
}: {
  integrationId: string
  className?: string
}) {
  const isMono = monochromeIcons.has(integrationId)
  const imgClass = isMono ? "dark:invert" : ""

  const svgUrl = svgFileIcons[integrationId]
  if (svgUrl) {
    return (
      <div className={className}>
        <img
          src={svgUrl}
          alt=""
          className={`h-5 w-5 object-contain ${imgClass}`}
        />
      </div>
    )
  }

  const InlineIcon = inlineIcons[integrationId]
  if (InlineIcon) {
    return (
      <div className={className}>
        <InlineIcon />
      </div>
    )
  }

  return (
    <div className={className}>
      <Link size={20} />
    </div>
  )
}
