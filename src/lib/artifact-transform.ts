/**
 * Parent-side JSX transform for artifact code.
 *
 * Transforms the agent's React/JSX code into vanilla JS before it enters the
 * sandboxed iframe, eliminating the need for Babel inside the iframe.
 *
 * - Strips React hook imports (hooks are provided as globals via preamble)
 * - Preserves @hammies/frontend component imports (resolved by import map in iframe)
 * - Strips unknown imports
 * - Detects export default component name
 * - Fixes common LLM code mistakes (multiline regex literals)
 * - Transforms JSX → React.createElement via @babel/standalone
 */
import { transform } from "@babel/standalone"

const REACT_HOOKS = [
  "useState", "useEffect", "useRef", "useCallback", "useMemo",
  "useReducer", "useContext", "createContext", "forwardRef", "memo",
  "Fragment", "Children", "cloneElement", "isValidElement",
] as const

const HOOKS_PREAMBLE = `const { ${REACT_HOOKS.join(", ")} } = React;\n`

export interface TransformResult {
  code: string
  exportedName: string | null
}

export function transformArtifactCode(source: string): TransformResult {
  if (!source) return { code: "", exportedName: null }

  const lines = source.split("\n")
  let exportedName: string | null = null
  const cleaned: string[] = []

  for (const line of lines) {
    const trimmed = line.trimStart()

    // Strip React/react-dom imports (hooks are globals via preamble)
    if (/^import\s/.test(trimmed) && /from\s+['"]react['"]/.test(trimmed)) continue
    if (/^import\s/.test(trimmed) && /from\s+['"]react-dom['"]/.test(trimmed)) continue
    if (/^import\s/.test(trimmed) && /from\s+['"]react\//.test(trimmed)) continue
    if (/^import\s/.test(trimmed) && /from\s+['"]react-dom\//.test(trimmed)) continue

    // Keep @hammies/frontend imports — resolved by import map in iframe
    if (/^import\s/.test(trimmed) && /from\s+['"]@hammies\/frontend/.test(trimmed)) {
      cleaned.push(line)
      continue
    }

    // Strip other imports (side-effect imports, unknown packages)
    if (/^import\s/.test(trimmed) && /from\s+['"]/.test(trimmed)) continue
    if (/^import\s+['"]/.test(trimmed)) continue

    // Handle export default function Name
    if (/^export\s+default\s+function\s+(\w+)/.test(trimmed)) {
      exportedName = trimmed.match(/^export\s+default\s+function\s+(\w+)/)![1]
      cleaned.push(trimmed.replace(/^export\s+default\s+/, ""))
      continue
    }

    // Handle standalone export default Name;
    if (/^export\s+default\s+/.test(trimmed)) {
      exportedName = trimmed.replace(/^export\s+default\s+/, "").replace(/;\s*$/, "").trim()
      continue
    }

    // Strip export keyword from other exports
    if (/^export\s+/.test(trimmed)) {
      cleaned.push(trimmed.replace(/^export\s+/, ""))
      continue
    }

    cleaned.push(line)
  }

  let code = cleaned.join("\n")

  // Fix common LLM mistake: regex with literal newline (/\n/g split across lines)
  code = code.replace(/\/\n\/([gimsuy]*)/g, "/\\n/$1")

  // Prepend hooks preamble
  code = HOOKS_PREAMBLE + code

  // Transform JSX → React.createElement
  const result = transform(code, { presets: ["react"] })

  return { code: result.code ?? "", exportedName }
}
