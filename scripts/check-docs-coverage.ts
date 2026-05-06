import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, relative, resolve } from "node:path"

const COVERAGE_DOC = "docs/documentation-coverage.md"
const OPENSPEC_ROOT = "openspec/specs"
const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".sql",
])

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&")
}

function globToRegExp(pattern: string): RegExp {
  const tokens: string[] = []

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]
    const next = pattern[index + 1]

    if (char === "*" && next === "*") {
      tokens.push(".*")
      index += 1
      continue
    }

    if (char === "*") {
      tokens.push("[^/]*")
      continue
    }

    tokens.push(escapeRegExp(char))
  }

  return new RegExp(`^${tokens.join("")}$`)
}

function parseCoverageMap(
  markdown: string,
): Array<{ owner: string; pattern: string; regex: RegExp }> {
  const blockMatch = markdown.match(/```docs-coverage\n([\s\S]*?)```/)

  if (!blockMatch?.[1]) {
    throw new Error(`Missing docs-coverage fenced block in ${COVERAGE_DOC}`)
  }

  return blockMatch[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => {
      const [owner, pattern, ...extra] = line.split("|").map((part) => part.trim())

      if (!owner || !pattern || extra.length > 0) {
        throw new Error(`Invalid docs coverage rule: ${line}`)
      }

      return { owner, pattern, regex: globToRegExp(pattern) }
    })
}

function getProjectFiles(): string[] {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf8",
  })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}

function findSpecFiles(root: string): string[] {
  if (!existsSync(root)) return []
  const out: string[] = []
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()!
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`
      if (entry.isDirectory()) {
        stack.push(full)
      } else if (entry.isFile() && entry.name === "spec.md") {
        out.push(full)
      }
    }
  }
  return out
}

function extractTechnicalNotesSection(markdown: string): string | null {
  const match = markdown.match(/##\s+Technical Notes\s*\n([\s\S]*?)(?=\n##\s|$)/i)
  return match?.[1] ?? null
}

function extractLinkTargets(section: string): string[] {
  const targets: string[] = []
  const re = /\[[^\]]+\]\(([^)]+)\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(section)) !== null) {
    const raw = m[1].trim()
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//")) continue
    targets.push(raw)
  }
  return targets
}

function expandDirectory(absDir: string): string[] {
  const out: string[] = []
  const stack = [absDir]
  while (stack.length > 0) {
    const dir = stack.pop()!
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`
      if (entry.isDirectory()) {
        stack.push(full)
      } else if (entry.isFile()) {
        out.push(full)
      }
    }
  }
  return out
}

const OPENSPEC_EXCLUDE_PATTERNS = [
  /(^|\/)__tests__\//,
  /\.test\.(ts|tsx|js|jsx|py)$/,
  /\.spec\.(ts|tsx|js|jsx)$/,
  /(^|\/)tests?\//,
  /(^|\/)e2e\//,
  /(^|\/)scripts\//,
  /\.config\.(ts|js|mjs|cjs)$/,
  /\.d\.ts$/,
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)\.next\//,
  /(^|\/)node_modules\//,
]

function isSourceFile(path: string): boolean {
  const dot = path.lastIndexOf(".")
  if (dot < 0) return false
  return SOURCE_EXTENSIONS.has(path.slice(dot))
}

function isOpenSpecScope(path: string): boolean {
  if (!isSourceFile(path)) return false
  return !OPENSPEC_EXCLUDE_PATTERNS.some((re) => re.test(path))
}

function runOpenSpecCoverage(packageRoot: string, projectFileSet: Set<string>): boolean {
  const specs = findSpecFiles(`${packageRoot}/${OPENSPEC_ROOT}`)
  if (specs.length === 0) {
    console.log("OpenSpec: no specs found at openspec/specs/, skipping (transitional).")
    return true
  }

  const coverage = new Map<string, string[]>()
  const staleRefs: Array<{ spec: string; target: string }> = []

  for (const specPath of specs) {
    const md = readFileSync(specPath, "utf8")
    const section = extractTechnicalNotesSection(md)
    if (!section) {
      console.warn(`OpenSpec: ${relative(packageRoot, specPath)} has no Technical Notes section`)
      continue
    }
    for (const target of extractLinkTargets(section)) {
      const noFragment = target.split("#")[0]
      if (!noFragment) continue
      const abs = resolve(dirname(specPath), noFragment)
      if (!existsSync(abs)) {
        staleRefs.push({ spec: specPath, target })
        continue
      }
      const stat = statSync(abs)
      const files = stat.isDirectory() ? expandDirectory(abs) : [abs]
      for (const file of files) {
        const rel = relative(packageRoot, file)
        if (!isSourceFile(rel)) continue
        if (!projectFileSet.has(rel)) continue
        const owners = coverage.get(rel) ?? []
        if (!owners.includes(specPath)) owners.push(specPath)
        coverage.set(rel, owners)
      }
    }
  }

  let ok = true

  if (staleRefs.length > 0) {
    console.error("OpenSpec: stale Technical Notes references (path does not exist):")
    for (const { spec, target } of staleRefs) {
      console.error(`  - ${relative(packageRoot, spec)} → ${target}`)
    }
    ok = false
  }

  const sourceFiles = [...projectFileSet].filter(isOpenSpecScope)
  const orphans = sourceFiles.filter((f) => !coverage.has(f))
  if (orphans.length > 0) {
    console.warn(
      `OpenSpec: ${orphans.length} source file(s) not yet referenced by any spec.md Technical Notes (warning during transition; full coverage still enforced via docs/documentation-coverage.md):`,
    )
    for (const file of orphans) {
      console.warn(`  - ${file}`)
    }
  }

  const multiOwned = [...coverage.entries()].filter(([, owners]) => owners.length > 1)
  if (multiOwned.length > 0) {
    console.warn("OpenSpec: source files claimed by multiple specs (split-domain smell, warning only during transition):")
    for (const [file, owners] of multiOwned) {
      const names = owners.map((o) => relative(packageRoot, o)).join(", ")
      console.warn(`  - ${file} ← ${names}`)
    }
  }

  if (ok) {
    console.log(
      `OpenSpec coverage: ${coverage.size}/${sourceFiles.length} source files referenced across ${specs.length} spec(s).`,
    )
  }
  return ok
}

const markdown = readFileSync(COVERAGE_DOC, "utf8")
const rules = parseCoverageMap(markdown)
const projectFiles = getProjectFiles()
const projectFileSet = new Set(projectFiles)

let exitCode = 0

const uncovered = projectFiles.filter((file) => !rules.some((rule) => rule.regex.test(file)))

if (uncovered.length > 0) {
  console.error("Documentation coverage is incomplete. Add ownership rules for:")
  for (const file of uncovered) {
    console.error(`  - ${file}`)
  }
  exitCode = 1
}

const missingOwnerDocs = [...new Set(rules.map((rule) => rule.owner))].filter(
  (owner) => !projectFiles.includes(owner),
)

if (missingOwnerDocs.length > 0) {
  console.error("Documentation coverage references missing owner docs:")
  for (const owner of missingOwnerDocs) {
    console.error(`  - ${owner}`)
  }
  exitCode = 1
}

if (exitCode === 0) {
  console.log(`Documentation coverage complete for ${projectFiles.length} project files.`)
}

const openspecOk = runOpenSpecCoverage(process.cwd(), projectFileSet)
if (!openspecOk) exitCode = 1

process.exit(exitCode)
