// scripts/migrate-curation-sessions.ts
//
// One-time migration: move JSONL files for previously-tracked curation sessions
// out of the user workspace's Agent SDK project directory into a dedicated
// curation project directory, and delete their DB rows from the `sessions`
// table. After this runs, curation sessions no longer co-mingle with user
// sessions in any storage layer.
//
// Usage (from packages/inbox):
//   npx tsx scripts/migrate-curation-sessions.ts --workspace ~/Github/hammies/hammies-workspace/packages/agent
//
// The --workspace flag must point at the agent workspace whose curation
// sessions should be migrated. If omitted, uses the WORKSPACE env var.

import { config } from "dotenv"
import pg from "pg"
import { resolve, dirname, join } from "path"
import { fileURLToPath } from "url"
import { homedir } from "os"
import { existsSync, mkdirSync, renameSync, readdirSync } from "fs"
import { workspaceProjectsDir } from "../server/lib/session-manager.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, "../.env") })

function parseArgs(): { workspace: string } {
  const args = process.argv.slice(2)
  const i = args.indexOf("--workspace")
  const raw = i !== -1 ? args[i + 1] : process.env.WORKSPACE
  if (!raw) {
    console.error("--workspace <path> or WORKSPACE env var is required")
    process.exit(1)
  }
  const expanded = raw.startsWith("~") ? raw.replace("~", homedir()) : raw
  return { workspace: resolve(expanded) }
}

async function main() {
  const { workspace } = parseArgs()
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.error("DATABASE_URL environment variable is required")
    process.exit(1)
  }

  const oldProjectDir = workspaceProjectsDir(workspace)
  const newProjectDir = workspaceProjectsDir(join(workspace, "context"))

  console.log("Workspace:", workspace)
  console.log("Source project dir:", oldProjectDir)
  console.log("Destination project dir:", newProjectDir)

  if (!existsSync(oldProjectDir)) {
    console.log("No source project directory — nothing to migrate.")
    return
  }

  const pool = new pg.Pool({ connectionString: databaseUrl })
  try {
    // Select session IDs previously tagged as context-backfill.
    const { rows } = await pool.query<{ id: string }>(
      "SELECT id FROM sessions WHERE trigger_source = 'context-backfill'",
    )
    console.log(`Found ${rows.length} curation session rows.`)

    if (rows.length === 0) {
      console.log("Nothing to migrate.")
      return
    }

    // Ensure the destination directory exists
    mkdirSync(newProjectDir, { recursive: true })

    const existingFiles = new Set(readdirSync(oldProjectDir))

    let moved = 0
    let missing = 0
    for (const { id } of rows) {
      const fileName = `${id}.jsonl`
      if (!existingFiles.has(fileName)) {
        missing++
        continue
      }
      const src = join(oldProjectDir, fileName)
      const dst = join(newProjectDir, fileName)
      if (existsSync(dst)) {
        // Destination already has it (re-run) — still drop the source
        console.log(`  destination already has ${fileName}, skipping move`)
      } else {
        renameSync(src, dst)
      }
      moved++
    }

    console.log(`Moved ${moved} JSONLs. Missing JSONLs (only DB row): ${missing}.`)

    const delResult = await pool.query(
      "DELETE FROM sessions WHERE trigger_source = 'context-backfill'",
    )
    console.log(`Deleted ${delResult.rowCount} DB rows from sessions.`)
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error("Migration failed:", err)
  process.exit(1)
})
