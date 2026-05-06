#!/usr/bin/env tsx
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const CHANGES_ROOT = "openspec/changes"
const ARCHIVE_ROOT = "openspec/changes/archive"

function usage(): never {
  console.error("Usage: archive-proposal <change-name>")
  console.error("  Moves openspec/changes/<change-name>/ to openspec/changes/archive/<change-name>/")
  console.error("  and prepends Archived-At/Archived-On frontmatter to proposal.md.")
  process.exit(2)
}

const changeName = process.argv[2]
if (!changeName || changeName.includes("/") || changeName === "archive") usage()

const src = resolve(CHANGES_ROOT, changeName)
const dst = resolve(ARCHIVE_ROOT, changeName)
const proposal = resolve(src, "proposal.md")

if (!existsSync(src)) {
  console.error(`No such change folder: ${src}`)
  process.exit(1)
}
if (!existsSync(proposal)) {
  console.error(`Missing proposal.md: ${proposal}`)
  process.exit(1)
}
if (existsSync(dst)) {
  console.error(`Archive target already exists: ${dst}`)
  process.exit(1)
}

const sha = execFileSync("git", ["log", "-1", "--format=%H", "--", src], {
  encoding: "utf8",
}).trim()
const date = execFileSync("git", ["log", "-1", "--format=%ad", "--date=short", "--", src], {
  encoding: "utf8",
}).trim()

if (!sha) {
  console.error(`No git history for ${src} — commit the proposal before archiving.`)
  process.exit(1)
}

const body = readFileSync(proposal, "utf8")
const frontmatterMatch = body.match(/^---\n([\s\S]*?)\n---\n/)
const stamp = `Archived-At: ${sha}\nArchived-On: ${date}`

let next: string
if (frontmatterMatch) {
  const inner = frontmatterMatch[1]
  next = body.replace(frontmatterMatch[0], `---\n${stamp}\n${inner}\n---\n`)
} else {
  next = `---\n${stamp}\n---\n\n${body}`
}

writeFileSync(proposal, next)
renameSync(src, dst)

console.log(`Archived ${changeName} → ${dst}`)
console.log(`  Archived-At: ${sha}`)
console.log(`  Archived-On: ${date}`)
