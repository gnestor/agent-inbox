#!/usr/bin/env node
// Coverage walker for OpenSpec specs. Pure Node (no transpile required).
//
// For each package, this script:
//   1. Walks openspec/specs/**/spec.md
//   2. Parses each spec's "Technical Notes" section, extracts markdown link targets
//   3. Cross-references against `git ls-files`
//
// Exit codes:
//   0  — every in-scope source file is referenced by at least one spec, no stale refs
//   1  — stale references (link targets that don't exist) OR orphans (in-scope files
//        not referenced by any spec)
//
// Multi-owner files emit a warning but do not fail. Set STRICT_MULTI_OWNER=1 to fail.

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, relative, resolve } from "node:path"

const OPENSPEC_ROOT = "openspec/specs"
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".sql"])

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
  /(^|\/)\.spec-gen\//,
]

function getProjectFiles() {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}

function findSpecFiles(root) {
  if (!existsSync(root)) return []
  const out = []
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`
      if (entry.isDirectory()) stack.push(full)
      else if (entry.isFile() && entry.name === "spec.md") out.push(full)
    }
  }
  return out
}

function extractTechnicalNotesSection(markdown) {
  const match = markdown.match(/##\s+Technical Notes\s*\n([\s\S]*?)(?=\n##\s|$)/i)
  return match?.[1] ?? null
}

function extractLinkTargets(section) {
  const targets = []
  const re = /\[[^\]]+\]\(([^)]+)\)/g
  let m
  while ((m = re.exec(section)) !== null) {
    const raw = m[1].trim()
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//")) continue
    targets.push(raw)
  }
  return targets
}

function expandDirectory(absDir) {
  const out = []
  const stack = [absDir]
  while (stack.length > 0) {
    const dir = stack.pop()
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`
      if (entry.isDirectory()) stack.push(full)
      else if (entry.isFile()) out.push(full)
    }
  }
  return out
}

function isSourceFile(path) {
  const dot = path.lastIndexOf(".")
  if (dot < 0) return false
  return SOURCE_EXTENSIONS.has(path.slice(dot))
}

function isOpenSpecScope(path) {
  if (!isSourceFile(path)) return false
  return !OPENSPEC_EXCLUDE_PATTERNS.some((re) => re.test(path))
}

const packageRoot = process.cwd()
const projectFiles = getProjectFiles()
const projectFileSet = new Set(projectFiles)

const specs = findSpecFiles(`${packageRoot}/${OPENSPEC_ROOT}`)
if (specs.length === 0) {
  console.error(`No specs found at ${OPENSPEC_ROOT}/. Run from a package root that has openspec/.`)
  process.exit(1)
}

const coverage = new Map()
const staleRefs = []

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

let exitCode = 0

if (staleRefs.length > 0) {
  console.error("OpenSpec: stale Technical Notes references (path does not exist):")
  for (const { spec, target } of staleRefs) {
    console.error(`  - ${relative(packageRoot, spec)} -> ${target}`)
  }
  exitCode = 1
}

const sourceFiles = projectFiles.filter(isOpenSpecScope)
const orphans = sourceFiles.filter((f) => !coverage.has(f))
if (orphans.length > 0) {
  const strictOrphans = process.env.STRICT_ORPHANS === "1"
  const log = strictOrphans ? console.error : console.warn
  log(`OpenSpec: ${orphans.length} source file(s) not referenced by any spec.md Technical Notes:`)
  for (const file of orphans) log(`  - ${file}`)
  if (strictOrphans) exitCode = 1
}

const multiOwned = [...coverage.entries()].filter(([, owners]) => owners.length > 1)
if (multiOwned.length > 0) {
  const strict = process.env.STRICT_MULTI_OWNER === "1"
  const log = strict ? console.error : console.warn
  log(`OpenSpec: ${multiOwned.length} source file(s) claimed by multiple specs (split-domain smell):`)
  for (const [file, owners] of multiOwned) {
    const names = owners.map((o) => relative(packageRoot, o)).join(", ")
    log(`  - ${file} <- ${names}`)
  }
  if (strict) exitCode = 1
}

if (exitCode === 0) {
  console.log(`OpenSpec coverage: ${coverage.size}/${sourceFiles.length} source files referenced across ${specs.length} spec(s).`)
}

process.exit(exitCode)
