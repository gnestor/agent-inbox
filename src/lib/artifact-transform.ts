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

  // Auto-inject missing React imports: if the code uses hooks/APIs but doesn't import them,
  // add the import. This handles agents that were told "hooks are globals" or simply forgot.
  const REACT_APIS = [
    "useState", "useEffect", "useRef", "useCallback", "useMemo",
    "useReducer", "useContext", "createContext", "forwardRef", "memo",
    "Fragment", "Children", "cloneElement", "isValidElement",
    "useId", "useTransition", "useDeferredValue", "startTransition",
  ]
  // Consolidate all React imports into one and inject missing APIs.
  // Collect all named imports and detect if React default is imported.
  let hasReactDefault = false
  const reactNamedImports = new Set<string>()
  // Remove all existing react imports — we'll emit a single consolidated one
  code = code.replace(/^import\s+(?:(\w+)\s*,?\s*)?\{([^}]*)\}\s*from\s+['"]react['"];?\s*$/gm, (_, def, named) => {
    if (def) hasReactDefault = true
    named.split(",").forEach((s: string) => { const n = s.trim(); if (n) reactNamedImports.add(n) })
    return ""
  })
  code = code.replace(/^import\s+(\w+)\s+from\s+['"]react['"];?\s*$/gm, (_, def) => {
    if (def) hasReactDefault = true
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
  const ARTIFACT_COMPONENTS = [
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
  ]
  const hasComponentImport = /from\s+['"]@hammies\/frontend\/components\/ui['"]/m.test(code)
  const componentImportMatch = hasComponentImport
    ? code.match(/import\s*\{([^}]*)\}\s*from\s+['"]@hammies\/frontend\/components\/ui['"]/)
    : null
  const alreadyImportedComponents = new Set<string>()
  if (componentImportMatch?.[1]) {
    componentImportMatch[1].split(",").forEach((s) => alreadyImportedComponents.add(s.trim()))
  }
  // Find components used in JSX (look for <ComponentName or React.createElement(ComponentName)
  const usedComponents = ARTIFACT_COMPONENTS.filter((name) =>
    !alreadyImportedComponents.has(name) && new RegExp(`\\b${name}\\b`).test(code)
  )
  if (usedComponents.length > 0) {
    if (componentImportMatch) {
      // Merge into existing import
      const existing = componentImportMatch[1].trim()
      const merged = existing ? `${existing}, ${usedComponents.join(", ")}` : usedComponents.join(", ")
      code = code.replace(componentImportMatch[0], `import { ${merged} } from '@hammies/frontend/components/ui'`)
    } else {
      // Add new import
      code = `import { ${usedComponents.join(", ")} } from '@hammies/frontend/components/ui';\n${code}`
    }
  }

  // Auto-inject cn import if used but not imported
  if (/\bcn\b/.test(code) && !/from\s+['"]@hammies\/frontend\/lib\/utils['"]/m.test(code)) {
    code = `import { cn } from '@hammies/frontend/lib/utils';\n${code}`
  }

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
