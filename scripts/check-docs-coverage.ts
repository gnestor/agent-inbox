import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

const COVERAGE_DOC = "docs/documentation-coverage.md"

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

const markdown = readFileSync(COVERAGE_DOC, "utf8")
const rules = parseCoverageMap(markdown)
const projectFiles = getProjectFiles()

const uncovered = projectFiles.filter((file) => !rules.some((rule) => rule.regex.test(file)))

if (uncovered.length > 0) {
  console.error("Documentation coverage is incomplete. Add ownership rules for:")
  for (const file of uncovered) {
    console.error(`  - ${file}`)
  }
  process.exit(1)
}

const missingOwnerDocs = [...new Set(rules.map((rule) => rule.owner))].filter(
  (owner) => !projectFiles.includes(owner),
)

if (missingOwnerDocs.length > 0) {
  console.error("Documentation coverage references missing owner docs:")
  for (const owner of missingOwnerDocs) {
    console.error(`  - ${owner}`)
  }
  process.exit(1)
}

console.log(`Documentation coverage complete for ${projectFiles.length} project files.`)
