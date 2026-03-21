/**
 * Parent-side JSX transform for artifact code.
 *
 * Transforms the agent's React/JSX code into vanilla JS that runs as an
 * inline <script type="module"> in the sandboxed iframe.
 *
 * - Preserves React imports (resolved by import map in iframe)
 * - Preserves @hammies/frontend imports (resolved by import map in iframe)
 * - Strips unknown package imports (would fail in the sandbox)
 * - Detects the default-exported component name for mounting
 * - Fixes common LLM code mistakes (multiline regex literals)
 * - Transforms JSX → React.createElement via @babel/standalone
 */
import { transform } from "@babel/standalone"

export interface TransformResult {
  /** Transformed vanilla JS code (no JSX, valid ES module) */
  code: string
  /** The default-exported component name, if detected */
  exportedName: string | null
}

/** Packages whose imports are preserved (resolved by iframe import map) */
const ALLOWED_IMPORTS = ["react", "react-dom", "react/", "react-dom/", "@hammies/frontend"]

function isAllowedImport(line: string): boolean {
  return ALLOWED_IMPORTS.some((pkg) => new RegExp(`from\\s+['"]${pkg.replace("/", "\\/")}`, "").test(line))
}

export function transformArtifactCode(source: string): TransformResult {
  if (!source) return { code: "", exportedName: null }

  const lines = source.split("\n")
  let exportedName: string | null = null
  const cleaned: string[] = []

  for (const line of lines) {
    const trimmed = line.trimStart()

    // Import handling: keep allowed packages, strip everything else
    if (/^import\s/.test(trimmed)) {
      if (/from\s+['"]/.test(trimmed) && isAllowedImport(trimmed)) {
        cleaned.push(line)
      }
      // Side-effect imports (import 'foo') and unknown packages are silently dropped
      continue
    }

    // Detect export default — keep it in the code, record the name for mounting
    if (/^export\s+default\s+function\s+(\w+)/.test(trimmed)) {
      exportedName = trimmed.match(/^export\s+default\s+function\s+(\w+)/)![1]
    } else if (/^export\s+default\s+\w+\s*;?\s*$/.test(trimmed)) {
      exportedName = trimmed.replace(/^export\s+default\s+/, "").replace(/;\s*$/, "").trim()
    }

    cleaned.push(line)
  }

  let code = cleaned.join("\n")

  // Fix common LLM mistake: regex with literal newline (/\n/g split across lines)
  code = code.replace(/\/\n\/([gimsuy]*)/g, "/\\n/$1")

  // Transform JSX → React.createElement (sourceType: "module" to support import/export)
  const result = transform(code, {
    presets: ["react"],
    sourceType: "module",
  })

  return { code: result.code ?? "", exportedName }
}

/**
 * Escape code for safe embedding inside a <script> tag.
 * The only dangerous sequence is </script> which would close the tag early.
 */
export function escapeForScript(code: string): string {
  return code.replace(/<\/script/gi, "<\\/script")
}
