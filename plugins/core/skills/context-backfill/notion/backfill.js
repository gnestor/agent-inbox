#!/usr/bin/env node
/**
 * Notion backfill for context/notion/ raw source index.
 *
 * Discovery uses BigQuery (metadata only — no content_markdown). Content is
 * fetched in batches of 20 pages to keep query sizes predictable and bounded.
 *
 * Private databases are excluded via private-page-ids.json (built once with
 * --build-exclusions). All subsequent runs load that file and filter in
 * JavaScript — no Notion API calls needed.
 *
 * Usage:
 *   node workflows/context-backfill/notion/backfill.js
 *   node ... --build-exclusions   # one-time: query private DBs
 *   node ... --status             # report progress without processing
 *   node ... --dry-run            # preview without writing files
 *   node ... --page-id <id>       # process a single page
 *   node ... --batch-size 20      # content fetch batch size (default 20)
 */

import 'dotenv/config';
import minimist from 'minimist';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Client } from '@notionhq/client';
import { REPO_ROOT, runBQ, loadManifest, saveManifest, ensureDir, readDirIds } from '../lib/utils.js';

const args = minimist(process.argv.slice(2), {
  default: {
    'batch-size': 20,
    'page-id': '',
    status: false,
    'dry-run': false,
    'build-exclusions': false,
  },
  string: ['page-id'],
  boolean: ['status', 'dry-run', 'build-exclusions'],
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const NOTION_DIR = `${REPO_ROOT}/context/notion`;
const MANIFEST_PATH = resolve(__dirname, 'manifest.json');
const PRIVATE_IDS_PATH = resolve(__dirname, 'private-page-ids.json');

// Notion databases to exclude (private/personal)
const PRIVATE_DATABASES = {
  '4af79ac2-ed1e-44ed-8f17-dd41b104575e': 'My Notes',
  '95036ce2-41d1-489b-b7c5-ecac76f2dbe6': 'Journal',
  '1f9c88f3-fa6e-4b12-90f1-da26ffc5454f': 'People',
  '1758a48d-ebe4-4da6-a600-3ad0c1bffe47': 'Links',
  'fd2381bf-80eb-4b8d-ac77-73af1d0dcc89': 'Projects',
};

function normalizeId(id) {
  const hex = id.replace(/-/g, '');
  if (hex.length !== 32) return id;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// hammies.notion.pages is small (~MB) — 1 GB billing cap is generous.
const BQ_MAX_BYTES = 1 * 1024 * 1024 * 1024;

const DEFAULT_MANIFEST = {
  version: 1,
  last_run: null,
  stats: { total_saved: 0, total_skipped_private: 0, total_failed: 0 },
  pages: {},
};

// ---------------------------------------------------------------------------
// Private ID exclusion list
// ---------------------------------------------------------------------------

async function loadPrivateIds() {
  try {
    const text = await readFile(PRIVATE_IDS_PATH, 'utf-8');
    const data = JSON.parse(text);
    return new Set(data.all_ids.map(normalizeId));
  } catch {
    return new Set();
  }
}

async function buildExclusions() {
  const token = process.env.NOTION_API_TOKEN;
  if (!token) throw new Error('NOTION_API_TOKEN env var not set');

  const notion = new Client({ auth: token });
  const result = {
    updated_at: new Date().toISOString().slice(0, 10),
    databases: {},
    all_ids: [],
  };

  for (const [rawId, name] of Object.entries(PRIVATE_DATABASES)) {
    const dbId = normalizeId(rawId);
    console.log(`  Querying "${name}" (${dbId})...`);
    const pageIds = [];
    let cursor;

    do {
      const resp = await notion.databases.query({
        database_id: dbId,
        ...(cursor ? { start_cursor: cursor } : {}),
        page_size: 100,
      });
      for (const page of resp.results) {
        pageIds.push(normalizeId(page.id));
      }
      cursor = resp.has_more ? resp.next_cursor : undefined;
    } while (cursor);

    result.databases[dbId] = { name, page_ids: pageIds };
    result.all_ids.push(...pageIds);
    console.log(`    → ${pageIds.length} pages`);
  }

  result.all_ids = [...new Set(result.all_ids)];
  await writeFile(PRIVATE_IDS_PATH, JSON.stringify(result, null, 2) + '\n');
  console.log(`\nSaved ${result.all_ids.length} private page IDs to private-page-ids.json`);
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

async function discoverPages() {
  const sql = `
    WITH latest AS (
      SELECT
        page_id,
        COALESCE(title, '(untitled)') AS title,
        COALESCE(url, '') AS url,
        content_markdown,
        _sdc_extracted_at,
        ROW_NUMBER() OVER (PARTITION BY page_id ORDER BY _sdc_extracted_at DESC) AS rn
      FROM \`hammies.notion.pages\`
    )
    SELECT
      page_id,
      title,
      url,
      LENGTH(COALESCE(content_markdown, '')) AS content_len,
      CAST(_sdc_extracted_at AS STRING) AS extracted_at
    FROM latest
    WHERE rn = 1
      AND LENGTH(COALESCE(content_markdown, '')) >= 50
    ORDER BY _sdc_extracted_at DESC
  `;
  const { rows } = await runBQ(sql, BQ_MAX_BYTES);
  return rows.map((r) => ({
    page_id: normalizeId(String(r.page_id ?? '')),
    title: String(r.title ?? '(untitled)'),
    url: String(r.url ?? ''),
    content_len: String(r.content_len ?? '0'),
    extracted_at: String(r.extracted_at ?? ''),
  }));
}

// ---------------------------------------------------------------------------
// Content fetch (batched)
// ---------------------------------------------------------------------------

async function fetchContentBatch(pageIds) {
  const quoted = pageIds.map((id) => `'${id}'`).join(', ');
  const sql = `
    WITH latest AS (
      SELECT
        page_id,
        COALESCE(content_markdown, '') AS content_markdown,
        ROW_NUMBER() OVER (PARTITION BY page_id ORDER BY _sdc_extracted_at DESC) AS rn
      FROM \`hammies.notion.pages\`
      WHERE page_id IN (${quoted})
    )
    SELECT page_id, content_markdown
    FROM latest
    WHERE rn = 1
  `;
  const { rows } = await runBQ(sql, BQ_MAX_BYTES);
  const map = new Map();
  for (const row of rows) {
    map.set(normalizeId(String(row.page_id)), String(row.content_markdown ?? ''));
  }
  return map;
}

// ---------------------------------------------------------------------------
// File write
// ---------------------------------------------------------------------------

function buildMarkdown(page, content) {
  return [
    '---',
    'type: notion-page',
    `page-id: ${page.page_id}`,
    `title: "${page.title.replace(/"/g, '\\"')}"`,
    `url: ${page.url}`,
    `date: ${page.extracted_at}`,
    '---',
    '',
    content,
  ].join('\n');
}

async function savePage(page, content) {
  const filePath = `${NOTION_DIR}/${page.page_id}.md`;
  await writeFile(filePath, buildMarkdown(page, content));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  await ensureDir(NOTION_DIR);

  if (args['build-exclusions']) {
    console.log('Building private page ID exclusion list...');
    await buildExclusions();
    return;
  }

  const manifest = await loadManifest(MANIFEST_PATH, DEFAULT_MANIFEST);
  const privateIds = await loadPrivateIds();

  if (privateIds.size === 0) {
    console.warn(
      'Warning: private-page-ids.json not found or empty.\n' +
      'Run with --build-exclusions first to exclude private databases.'
    );
  }

  console.log('Discovering pages from BigQuery...');
  const allPages = await discoverPages();
  console.log(`  Found ${allPages.length} total pages`);

  const privateFiltered = allPages.filter((p) => privateIds.has(p.page_id));
  const pages = allPages.filter((p) => !privateIds.has(p.page_id));
  if (privateFiltered.length > 0) {
    console.log(`  Excluded ${privateFiltered.length} private pages`);
  }

  const savedIds = await readDirIds(NOTION_DIR);
  const pending = pages.filter((p) => !savedIds.has(p.page_id));
  const alreadySaved = pages.length - pending.length;

  if (args['page-id']) {
    const targetId = normalizeId(args['page-id']);
    const target = allPages.find((p) => p.page_id === targetId);
    if (!target) {
      console.error(`Page ${targetId} not found in BigQuery discovery results`);
      process.exit(1);
    }
    pending.splice(0, pending.length, target);
  }

  if (args.status) {
    console.log('\nStatus:');
    console.log(`  Total in BigQuery:     ${allPages.length}`);
    console.log(`  Private (excluded):    ${privateFiltered.length}`);
    console.log(`  Already saved:         ${alreadySaved}`);
    console.log(`  Pending:               ${pending.length}`);
    console.log(`  Manifest last run:     ${manifest.last_run ?? 'never'}`);
    console.log(`  Manifest total saved:  ${manifest.stats.total_saved}`);
    return;
  }

  if (pending.length === 0) {
    console.log('Nothing to do — all pages already saved.');
    return;
  }

  if (args['dry-run']) {
    console.log(`\nDry run — would process ${pending.length} pages:`);
    for (const p of pending.slice(0, 20)) {
      console.log(`  ${p.page_id}  ${p.title} (${p.content_len} chars)`);
    }
    if (pending.length > 20) console.log(`  ... and ${pending.length - 20} more`);
    return;
  }

  console.log(`\nProcessing ${pending.length} pages in batches of ${args['batch-size']}...`);

  let saved = 0;
  let failed = 0;
  const batchSize = args['batch-size'];

  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    const batchIds = batch.map((p) => p.page_id);

    let contentMap;
    try {
      contentMap = await fetchContentBatch(batchIds);
    } catch (err) {
      console.error(`Batch ${Math.floor(i / batchSize) + 1} content fetch failed: ${err}`);
      failed += batch.length;
      continue;
    }

    for (const page of batch) {
      const content = contentMap.get(page.page_id) ?? '';
      try {
        await savePage(page, content);
        manifest.pages[page.page_id] = {
          saved_at: new Date().toISOString(),
          title: page.title,
          content_len: parseInt(page.content_len, 10),
        };
        saved++;
        console.log(`  [${saved + alreadySaved}/${pages.length}] ${page.title}`);
      } catch (err) {
        console.error(`  Failed to save ${page.page_id} (${page.title}): ${err}`);
        failed++;
      }
    }

    manifest.stats.total_saved = saved;
    manifest.stats.total_skipped_private = privateFiltered.length;
    manifest.stats.total_failed = failed;
    await saveManifest(MANIFEST_PATH, manifest);
  }

  console.log(`\nDone. Saved: ${saved}, Failed: ${failed}`);
  if (saved > 0) {
    console.log('\nRun to re-index:');
    console.log('  qmd update && qmd embed');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
