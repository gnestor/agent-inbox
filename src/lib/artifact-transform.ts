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
// Lazy-load @babel/standalone (~37MB) — only needed when viewing React artifacts
type BabelTransform = (code: string, opts: Record<string, unknown>) => { code: string | null }
let _babelTransform: BabelTransform | null = null
async function ensureBabel(): Promise<BabelTransform> {
  if (!_babelTransform) {
    const babel = await import("@babel/standalone")
    _babelTransform = babel.transform as BabelTransform
  }
  return _babelTransform
}

export interface TransformResult {
  /** Transformed vanilla JS code (no JSX, valid ES module) */
  code: string
  /** The default-exported component name, if detected */
  exportedName: string | null
}

/** Packages whose imports are preserved (resolved by iframe import map) */
const ALLOWED_IMPORTS = [
  "react", "react-dom", "react/", "react-dom/",
  "@hammies/frontend",
  "recharts", "lucide-react", "d3", "lodash",
]

function isAllowedImport(line: string): boolean {
  return ALLOWED_IMPORTS.some((pkg) => new RegExp(`from\\s+['"]${pkg.replace("/", "\\/")}`, "").test(line))
}

/** Known UI component names that auto-import provides from @hammies/frontend */
const ARTIFACT_COMPONENTS = new Set([
  "Button", "Card", "CardHeader", "CardTitle", "CardDescription", "CardContent", "CardFooter", "CardAction",
  "Badge", "Input", "Textarea", "Label",
  "Select", "SelectContent", "SelectGroup", "SelectItem", "SelectLabel", "SelectTrigger", "SelectValue",
  "Separator", "Switch", "Checkbox",
  "Tabs", "TabsList", "TabsTrigger", "TabsContent",
  "Table", "TableHeader", "TableBody", "TableFooter", "TableRow", "TableHead", "TableCell", "TableCaption",
  "Skeleton", "Progress", "Avatar", "AvatarImage", "AvatarFallback",
  "Accordion", "AccordionItem", "AccordionTrigger", "AccordionContent",
  "Alert", "AlertTitle", "AlertDescription",
  "Toggle", "ToggleGroup", "ToggleGroupItem",
  "Tooltip", "TooltipTrigger", "TooltipContent", "TooltipProvider",
  "RadioGroup", "RadioGroupItem", "Spinner",
])

/**
 * Normalize the `data` argument from a render_output call into `{ code, title }`.
 * Handles three shapes the agent may send:
 *   - `{ code: "...", title?: "..." }`   (correct)
 *   - `"<jsx string>"`                   (bare code string)
 *   - `'{"code":"...","title":"..."}'`   (stringified JSON — LLM mistake)
 */
export function unwrapReactData(data: unknown): { code: string | undefined; title: string | undefined } {
  let d = data
  if (typeof d === "string") {
    try {
      const parsed = JSON.parse(d)
      if (parsed && typeof parsed === "object" && typeof (parsed as Record<string, unknown>).code === "string") d = parsed
    } catch { /* treat as raw code string */ }
  }
  if (typeof d === "string") return { code: d, title: undefined }
  if (d && typeof d === "object") {
    const o = d as Record<string, unknown>
    return { code: typeof o.code === "string" ? o.code : undefined, title: typeof o.title === "string" ? o.title : undefined }
  }
  return { code: undefined, title: undefined }
}

export async function transformArtifactCode(source: string): Promise<TransformResult> {
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

    // Strip destructuring from hallucinated globals (e.g. `const { Card, ... } = Components`)
    // Only strip if destructured names overlap with known UI components.
    const destructMatch = trimmed.match(/^(?:const|let|var)\s+\{([^}]+)\}\s*=\s*\w+\s*;?\s*$/)
    if (destructMatch) {
      const names = destructMatch[1]!.split(",").map((s) => s.split(":").pop()!.trim())
      if (names.some((n) => ARTIFACT_COMPONENTS.has(n))) {
        continue
      }
    }

    // Detect export default — keep it in the code, record the name for mounting
    if (/^export\s+default\s+function\s+(\w+)/.test(trimmed)) {
      exportedName = trimmed.match(/^export\s+default\s+function\s+(\w+)/)?.[1] ?? null
    } else if (/^export\s+default\s+\w+\s*;?\s*$/.test(trimmed)) {
      exportedName = trimmed.replace(/^export\s+default\s+/, "").replace(/;\s*$/, "").trim()
    }

    cleaned.push(line)
  }

  let code = cleaned.join("\n")

  // Auto-inject missing React imports: if the code uses hooks/APIs but doesn't import them,
  // add the import. This handles agents that were told "hooks are globals" or simply forgot.
  const REACT_APIS = [
    "useState", "useEffect", "useRef", "useCallback", "useMemo",
    "useReducer", "useContext", "createContext", "forwardRef", "memo",
    "Fragment", "Children", "cloneElement", "isValidElement",
    "useId", "useTransition", "useDeferredValue", "startTransition",
  ]
  // Consolidate all React imports into one and inject missing APIs.
  const reactNamedImports = new Set<string>()
  // Remove all existing react imports — we'll emit a single consolidated one
  code = code.replace(/^import\s+(?:(\w+)\s*,?\s*)?\{([^}]*)\}\s*from\s+['"]react['"];?\s*$/gm, (_, _def, named) => {
    named.split(",").forEach((s: string) => { const n = s.trim(); if (n) reactNamedImports.add(n) })
    return ""
  })
  code = code.replace(/^import\s+(\w+)\s+from\s+['"]react['"];?\s*$/gm, () => {
    return ""
  })
  // Find which React APIs are used but not yet imported
  const missing = REACT_APIS.filter((api) =>
    !reactNamedImports.has(api) && new RegExp(`\\b${api}\\b`).test(code)
  )
  for (const m of missing) reactNamedImports.add(m)
  // Always import React default — needed for JSX → React.createElement
  const namedList = [...reactNamedImports].join(", ")
  const reactImport = namedList
    ? `import React, { ${namedList} } from 'react';`
    : `import React from 'react';`
  code = `${reactImport}\n${code}`

  // Auto-inject missing @hammies/frontend component imports
  // Consolidate all @hammies/frontend imports (barrel and per-component paths) into one.
  const alreadyImportedComponents = new Set<string>()
  code = code.replace(
    /^import\s*\{([^}]*)\}\s*from\s+['"]@hammies\/frontend\/components\/ui(?:\/\w+)?['"];?\s*$/gm,
    (_, named) => {
      named.split(",").forEach((s: string) => { const n = s.trim(); if (n) alreadyImportedComponents.add(n) })
      return ""
    },
  )
  // Find components used in code but not yet imported (skip locally declared ones)
  const localDecls = new Set<string>()
  for (const m of code.matchAll(/(?:function|class)\s+(\w+)/g)) localDecls.add(m[1]!)
  for (const m of code.matchAll(/(?:const|let|var)\s+(\w+)\s*=/g)) localDecls.add(m[1]!)
  const usedComponents = [...ARTIFACT_COMPONENTS].filter((name) =>
    !alreadyImportedComponents.has(name) && !localDecls.has(name) && new RegExp(`\\b${name}\\b`).test(code)
  )
  for (const c of usedComponents) alreadyImportedComponents.add(c)
  if (alreadyImportedComponents.size > 0) {
    code = `import { ${[...alreadyImportedComponents].join(", ")} } from '@hammies/frontend/components/ui';\n${code}`
  }

  // Auto-inject cn import if used but not imported
  if (/\bcn\b/.test(code) && !/from\s+['"]@hammies\/frontend\/lib\/utils['"]/m.test(code)) {
    code = `import { cn } from '@hammies/frontend/lib/utils';\n${code}`
  }

  // Fix common LLM mistake: regex with literal newline (/\n/g split across lines)
  code = code.replace(/\/\n\/([gimsuy]*)/g, "/\\n/$1")

  if (!exportedName) {
    const codeLines = code.split("\n")
    const importLines = codeLines.filter((l) => /^import\s/.test(l.trimStart()))
    const bodyLines = codeLines.filter((l) => !/^import\s/.test(l.trimStart()))
    const body = bodyLines.join("\n").trim()

    if (codeLines.some((l) => /^return[\s(]/.test(l))) {
      // Bare top-level `return` — wrap in App function
      code = importLines.join("\n") + "\n\nexport default function App() {\n" + bodyLines.join("\n") + "\n}\n"
      exportedName = "App"
    } else if (/^\(\s*\)\s*=>/.test(body)) {
      // Bare arrow function expression: `() => { ... }` — assign and export
      code = importLines.join("\n") + "\n\nconst App = " + body + "\nexport default App\n"
      exportedName = "App"
    }
  }

  // Transform JSX → React.createElement (sourceType: "module" to support import/export)
  const transform = await ensureBabel()
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
