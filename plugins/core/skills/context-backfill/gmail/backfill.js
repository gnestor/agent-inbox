#!/usr/bin/env node
/**
 * Email backfill for qmd raw index.
 *
 * Discovery strategy:
 *   - Initial/full: BigQuery (messages_headers, ~115 GB scan)
 *   - Incremental:  Gmail API search (zero BQ cost) — uses `after:` query
 *     with TypeScript-side sender/subject filtering
 *
 * Thread content is always fetched via Gmail API — clean UTF-8, no base64 issues.
 *
 * Filter rules live in gmail/config.yaml (sender/subject include/exclude patterns).
 *
 * Usage:
 *   node workflows/context-backfill/gmail/backfill.js
 *   node workflows/context-backfill/gmail/backfill.js --batch-size 50
 *   node workflows/context-backfill/gmail/backfill.js --contact wendi@thesourcingco.net
 *   node workflows/context-backfill/gmail/backfill.js --status
 *   node workflows/context-backfill/gmail/backfill.js --full
 *   node workflows/context-backfill/gmail/backfill.js --cleanup
 *   node workflows/context-backfill/gmail/backfill.js --prune
 */

import 'dotenv/config';
import minimist from 'minimist';
import { parse as parseYaml } from 'yaml';
import { readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { getGoogleAccessToken } from '../../../.claude/skills/google-workspace/scripts/google-auth.js';
import { REPO_ROOT, runBQ, cleanBody, loadManifest, saveManifest, truncateArray, readDirIds, ensureDir } from '../lib/utils.js';

const args = minimist(process.argv.slice(2), {
  default: { 'batch-size': 50, contact: '', status: false, full: false, cleanup: false, prune: false, 'dry-run': false },
  string: ['contact'],
  boolean: ['status', 'full', 'cleanup', 'prune', 'dry-run'],
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const QMD_EMAILS_DIR = `${REPO_ROOT}/context/gmail`;
const FILTERS_PATH = resolve(__dirname, 'config.yaml');
const MANIFEST_PATH = resolve(__dirname, 'manifest.json');

// ---------------------------------------------------------------------------
// Gmail API client
// ---------------------------------------------------------------------------

const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
const GMAIL_CONCURRENCY = 10;

async function gmailRequest(endpoint) {
  const token = await getGoogleAccessToken(GMAIL_SCOPES);
  const resp = await fetch(`https://gmail.googleapis.com/gmail/v1${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Gmail API ${resp.status}: ${body.slice(0, 200)}`);
  }
  return resp.json();
}

function decodeBase64Url(data) {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf-8');
}

/** Decode quoted-printable text (Content-Transfer-Encoding: quoted-printable). */
function decodeQuotedPrintable(text) {
  return text
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
}

function getTextFromPart(part) {
  if (!part?.body?.data) return null;
  const raw = decodeBase64Url(part.body.data);
  const cte = part.headers?.find(
    (h) => h.name.toLowerCase() === 'content-transfer-encoding'
  )?.value?.toLowerCase() ?? '';
  return cte === 'quoted-printable' ? decodeQuotedPrintable(raw) : raw;
}

function getEmailBody(payload) {
  if (!payload) return '';

  if (payload.body?.data) {
    const raw = decodeBase64Url(payload.body.data);
    const cte = payload.headers?.find(
      (h) => h.name.toLowerCase() === 'content-transfer-encoding'
    )?.value?.toLowerCase() ?? '';
    return cte === 'quoted-printable' ? decodeQuotedPrintable(raw) : raw;
  }

  if (payload.parts) {
    const textPart = payload.parts.find((p) => p.mimeType === 'text/plain');
    const text = getTextFromPart(textPart);
    if (text) return text;

    for (const part of payload.parts) {
      if (part.parts) {
        const sub = part.parts.find((p) => p.mimeType === 'text/plain');
        const t = getTextFromPart(sub);
        if (t) return t;
      }
    }

    const htmlPart = payload.parts.find((p) => p.mimeType === 'text/html');
    const html = getTextFromPart(htmlPart);
    if (html) {
      return html
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }
  }
  return '';
}

function getHeader(msg, name) {
  return msg.payload?.headers?.find(
    (h) => h.name.toLowerCase() === name.toLowerCase()
  )?.value ?? '';
}

// messages_headers is ~115 GB — BQ cap for full discovery queries.
const BQ_MAX_BYTES = 150 * 1024 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

async function loadFilters() {
  const yaml = await readFile(FILTERS_PATH, 'utf-8');
  return parseYaml(yaml);
}

/** Generate BigQuery WHERE clause fragments from filter config. */
function buildFilterSQL(filters) {
  const toLike = (p) =>
    `LOWER(from_raw) LIKE '%${p.toLowerCase().replace(/'/g, "\\'")}%'`;

  const senderExcludes = filters.exclude.sender_patterns
    .map(p => `NOT ${toLike(p)}`)
    .join('\n        AND ');

  const subjectExcludes = filters.exclude.subject_patterns
    .map(p => `LOWER(subject) NOT LIKE '%${p.toLowerCase().replace(/'/g, "\\'")}%'`)
    .join('\n          AND ');

  const internalList = filters.exclude.internal_senders
    .map(e => `'${e.toLowerCase()}'`)
    .join(', ');

  const internalExcludes = `from_email NOT IN (${internalList})`;

  const includeOverrides = filters.include.sender_patterns.length > 0
    ? filters.include.sender_patterns.map(p => toLike(p)).join(' OR ')
    : 'FALSE';

  return { senderExcludes, subjectExcludes, internalExcludes, includeOverrides };
}

// ---------------------------------------------------------------------------
// Thread ID discovery — Gmail API (incremental, zero BQ cost)
// ---------------------------------------------------------------------------

async function discoverViaGmailApi(sinceMs) {
  const d = new Date(sinceMs);
  const query = `after:${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} -in:inbox`;

  const threadIds = new Set();
  let pageToken;
  let pages = 0;

  process.stdout.write(`  Gmail API search: "${query}"...`);

  do {
    const params = new URLSearchParams({ q: query, maxResults: '500' });
    if (pageToken) params.set('pageToken', pageToken);

    const data = await gmailRequest(`/users/me/messages?${params}`);
    for (const msg of data.messages ?? []) {
      threadIds.add(msg.threadId);
    }
    pageToken = data.nextPageToken;
    pages++;
  } while (pageToken);

  console.log(` ${threadIds.size} threads (${pages} pages)`);
  return [...threadIds];
}

/**
 * Check whether a fetched thread passes sender/subject filters.
 */
function threadPassesFilters(row, filters) {
  let messages;
  try {
    messages = JSON.parse(row.messages_json || '[]');
  } catch {
    return false;
  }

  const internalSet = new Set(filters.exclude.internal_senders.map(e => e.toLowerCase()));

  const senderEmails = messages
    .map(m => (m.from?.match(/<([^>]+)>/)?.[1] ?? m.from ?? '').toLowerCase())
    .filter(Boolean);

  const externalSenders = senderEmails.filter(s => !internalSet.has(s));
  if (externalSenders.length === 0) return false;

  if (
    filters.include.sender_patterns.length > 0 &&
    externalSenders.some(s =>
      filters.include.sender_patterns.some(p => s.includes(p.toLowerCase()))
    )
  ) {
    return true;
  }

  const allExcluded = externalSenders.every(s =>
    filters.exclude.sender_patterns.some(p => s.includes(p.toLowerCase()))
  );
  if (allExcluded) return false;

  const subject = (row.subject ?? '').toLowerCase();
  if (
    filters.exclude.subject_patterns.some(p => subject.includes(p.toLowerCase()))
  ) {
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Thread ID discovery — BigQuery (full backfill, ~115 GB scan)
// ---------------------------------------------------------------------------

async function getAllThreadIds(filters, sinceMs = 0) {
  const { senderExcludes, subjectExcludes, internalExcludes, includeOverrides } =
    buildFilterSQL(filters);

  const sinceClause = sinceMs > 0
    ? `AND CAST(internalDate AS INT64) > ${sinceMs}`
    : '';

  const sql = `
    WITH filtered AS (
      SELECT
        threadId,
        LOWER(REGEXP_EXTRACT(from_raw, r'<([^>]+)>')) as from_email,
        CAST(internalDate AS INT64) as ts
      FROM \`hammies.gmail.messages_headers\`
      WHERE 'TRASH' NOT IN UNNEST(labelIds)
        AND 'SPAM' NOT IN UNNEST(labelIds)
        AND 'INBOX' NOT IN UNNEST(labelIds)
        ${sinceClause}
        AND (
          (${senderExcludes})
          OR (${includeOverrides})
        )
        AND (subject IS NULL OR (
          ${subjectExcludes}
        ))
    ),
    valuable_contacts AS (
      SELECT from_email
      FROM filtered
      WHERE ${internalExcludes}
        AND from_email IS NOT NULL
      GROUP BY from_email
      HAVING COUNT(DISTINCT threadId) > 1
    )
    SELECT DISTINCT threadId
    FROM filtered
    WHERE from_email IN (SELECT from_email FROM valuable_contacts)
  `;

  process.stdout.write('  Querying thread IDs...');
  const result = await runBQ(sql, BQ_MAX_BYTES);
  console.log(` ${result.rows.length}`);
  return result.rows.map(r => r.threadId);
}

async function findTrashedThreadIds(savedIds) {
  const trashed = [];
  const BATCH = 500;

  for (let i = 0; i < savedIds.length; i += BATCH) {
    const batch = savedIds.slice(i, i + BATCH);
    const idList = batch.map(id => `'${id}'`).join(',');

    const sql = `
      SELECT DISTINCT threadId
      FROM \`hammies.gmail.messages_headers\`
      WHERE threadId IN (${idList})
        AND 'TRASH' NOT IN UNNEST(labelIds)
        AND 'SPAM' NOT IN UNNEST(labelIds)
    `;

    const result = await runBQ(sql, BQ_MAX_BYTES);
    const liveIds = new Set(result.rows.map(r => r.threadId));

    for (const id of batch) {
      if (!liveIds.has(id)) trashed.push(id);
    }

    process.stdout.write(
      `\r  Checked ${Math.min(i + BATCH, savedIds.length)}/${savedIds.length}, found ${trashed.length} trashed   `
    );
  }
  console.log();
  return trashed;
}

async function getThreadIdsForContact(email) {
  const escaped = email.toLowerCase().replace(/'/g, "\\'");
  const sql = `
    SELECT DISTINCT threadId
    FROM (
      SELECT threadId, LOWER(REGEXP_EXTRACT(from_raw, r'<([^>]+)>')) as from_email
      FROM \`hammies.gmail.messages_headers\`
      WHERE 'TRASH' NOT IN UNNEST(labelIds)
        AND 'SPAM' NOT IN UNNEST(labelIds)
    )
    WHERE from_email = '${escaped}'
  `;
  const result = await runBQ(sql, BQ_MAX_BYTES);
  return result.rows.map(r => r.threadId);
}

// ---------------------------------------------------------------------------
// Thread content fetch
// ---------------------------------------------------------------------------

async function fetchThreadBatch(threadIds) {
  const threads = new Map();

  for (let i = 0; i < threadIds.length; i += GMAIL_CONCURRENCY) {
    const chunk = threadIds.slice(i, i + GMAIL_CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(async (threadId) => {
        const data = await gmailRequest(`/users/me/threads/${threadId}?format=full`);
        return { threadId, data };
      })
    );

    for (const r of results) {
      if (r.status === 'rejected') continue;
      const { threadId, data } = r.value;
      const messages = data.messages ?? [];
      if (messages.length === 0) continue;

      const subject = getHeader(messages[0], 'Subject') || 'Unknown Subject';
      const participants = [
        ...new Set(messages.map(m => getHeader(m, 'From')).filter(Boolean)),
      ].join(', ');
      const firstTs = messages[0].internalDate
        ? new Date(Number(messages[0].internalDate)).toISOString().replace(/\.\d{3}Z$/, 'Z')
        : '';

      const messagesJson = JSON.stringify(
        messages.map(msg => ({
          from: getHeader(msg, 'From'),
          to: getHeader(msg, 'To'),
          date: getHeader(msg, 'Date'),
          subject: getHeader(msg, 'Subject'),
          body: getEmailBody(msg.payload).slice(0, 20000),
        }))
      );

      threads.set(threadId, { threadId, subject, participants, first_date: firstTs, messages_json: messagesJson });
    }
  }

  return threads;
}

// ---------------------------------------------------------------------------
// Markdown formatting
// ---------------------------------------------------------------------------

function formatThreadMarkdown(row) {
  const subject = row.subject || 'Unknown Subject';
  const participants = (row.participants || '').split(',').map(p => p.trim()).filter(Boolean);
  const partsList = participants.map(p => `"${p.replace(/"/g, '\\"')}"`).join(', ');

  const frontmatter = `---
type: email-thread
thread-id: ${row.threadId}
subject: "${subject.replace(/"/g, '\\"')}"
participants: [${partsList}]
date: ${row.first_date}
---

`;

  let messages = [];
  try {
    messages = JSON.parse(row.messages_json || '[]');
  } catch {
    messages = [];
  }

  const { items: displayMessages, skipped } = truncateArray(messages, 3, 5);

  const renderMsg = (m) => [
    `**From:** ${m.from || ''}`,
    `**To:** ${m.to || ''}`,
    `**Date:** ${m.date || ''}`,
    `**Subject:** ${m.subject || ''}`,
    '',
    cleanBody(m.body || ''),
    '',
    '---',
  ].join('\n');

  const parts = [];
  if (skipped > 0) {
    displayMessages.slice(0, 3).forEach(m => parts.push(renderMsg(m)));
    parts.push(`\n*[… ${skipped} messages omitted …]*\n`);
    displayMessages.slice(3).forEach(m => parts.push(renderMsg(m)));
  } else {
    displayMessages.forEach(m => parts.push(renderMsg(m)));
  }

  return frontmatter + parts.join('\n\n');
}

const DEFAULT_MANIFEST = {
  version: 2,
  description: 'Tracks qmd email backfill progress.',
  last_run: null,
  last_run_ms: 0,
  stats: { total_indexed: 0, total_failed: 0 },
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  await ensureDir(QMD_EMAILS_DIR);

  const batchSize = args['batch-size'];
  const targetContact = args.contact;
  const statusOnly = args.status;
  const fullRun = args.full;
  const cleanupMode = args.cleanup;
  const pruneMode = args.prune;
  const dryRun = args['dry-run'];

  const filters = await loadFilters();
  const manifest = await loadManifest(MANIFEST_PATH, DEFAULT_MANIFEST);

  if (cleanupMode) {
    console.log('=== Email Backfill Cleanup ===');
    console.log('Scanning for trashed/deleted threads in indexed files...\n');

    const entries = await readdir(QMD_EMAILS_DIR);
    const savedIds = entries
      .filter(name => name.endsWith('.md'))
      .map(name => name.replace('.md', ''));

    console.log(`  Indexed files: ${savedIds.length}`);
    const trashed = await findTrashedThreadIds(savedIds);

    if (trashed.length === 0) {
      console.log('  No trashed threads found. Index is clean.');
      return;
    }

    console.log(`\n  Removing ${trashed.length} trashed threads...`);
    for (const id of trashed) {
      try {
        await unlink(`${QMD_EMAILS_DIR}/${id}.md`);
      } catch {
        // file already gone
      }
    }

    console.log(`  Removed ${trashed.length} files.`);
    console.log(`\nRun: qmd update`);
    return;
  }

  if (pruneMode) {
    console.log(`=== Email Backfill Prune${dryRun ? ' (dry run)' : ''} ===`);
    console.log('Removing indexed files whose sender matches exclude patterns...\n');

    const excludePatterns = filters.exclude.sender_patterns.map(p => p.toLowerCase());
    const includePatterns = filters.include.sender_patterns.map(p => p.toLowerCase());
    const internalSenders = new Set(filters.exclude.internal_senders.map(e => e.toLowerCase()));

    const isInternal = (addr) =>
      internalSenders.has(addr.toLowerCase()) ||
      internalSenders.has((addr.match(/<([^>]+)>/)?.[1] ?? addr).toLowerCase());

    const shouldExclude = (participantsRaw) => {
      const participants = [];
      const arrayMatch = participantsRaw.match(/^\[(.+)\]$/s);
      if (arrayMatch) {
        for (const m of arrayMatch[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
          participants.push(m[1]);
        }
      } else {
        participants.push(participantsRaw.replace(/^["']|["']$/g, ''));
      }

      const external = participants.filter(p => !isInternal(p));
      if (external.length === 0) return true;

      for (const p of external) {
        const lower = p.toLowerCase();
        if (includePatterns.some(pat => lower.includes(pat))) return false;
        if (!excludePatterns.some(pat => lower.includes(pat))) return false;
      }
      return true;
    };

    const allEntries = (await readdir(QMD_EMAILS_DIR)).filter(name => name.endsWith('.md'));

    let checked = 0, pruned = 0, kept = 0, unparseable = 0;

    for (const entryName of allEntries) {
      const path = `${QMD_EMAILS_DIR}/${entryName}`;
      const content = await readFile(path, 'utf-8');

      const match = content.match(/^---\n([\s\S]*?)\n---/);
      if (!match) { unparseable++; continue; }

      const participantsMatch = match[1].match(/^participants:\s*(.+)$/m);
      const subjectMatch = match[1].match(/^subject:\s*"(.+)"$/m);
      const participantsStr = participantsMatch?.[1] ?? '';
      const subject = subjectMatch?.[1] ?? '';

      checked++;

      const senderExcluded = shouldExclude(participantsStr);

      const subjectLower = subject.toLowerCase();
      const subjectExcluded = filters.exclude.subject_patterns.some(
        p => subjectLower.includes(p.toLowerCase())
      );

      if (senderExcluded || subjectExcluded) {
        pruned++;
        if (!dryRun) {
          await unlink(path);
        } else {
          const reason = senderExcluded ? `sender: ${participantsStr.slice(0, 60)}` : `subject: ${subject.slice(0, 60)}`;
          if (pruned <= 10) console.log(`  [prune] ${entryName}: ${reason}`);
        }
      } else {
        kept++;
      }

      if (checked % 1000 === 0) {
        process.stdout.write(`\r  Checked ${checked}, pruned ${pruned}...`);
      }
    }

    console.log(`\r  Checked ${checked}, pruned ${pruned}        `);
    console.log(`\n  Pruned:  ${pruned}`);
    console.log(`  Kept:    ${kept}`);
    if (unparseable > 0) console.log(`  Skipped (no frontmatter): ${unparseable}`);

    if (!dryRun && pruned > 0) {
      console.log(`\nRun: qmd update`);
    }
    return;
  }

  if (statusOnly) {
    console.log('=== Email Backfill Status ===\n');
    const threadIds = await getAllThreadIds(filters);
    const savedFiles = await readDirIds(QMD_EMAILS_DIR);
    const pending = threadIds.filter(id => !savedFiles.has(id)).length;
    const covered = threadIds.length - pending;
    const pct = threadIds.length > 0
      ? ((covered / threadIds.length) * 100).toFixed(1)
      : '0.0';
    console.log(`  Total threads (filter):  ${threadIds.length}`);
    console.log(`  Covered:                 ${covered} (${pct}%)`);
    console.log(`  Pending:                 ${pending}`);
    console.log(`  Files in index:          ${savedFiles.size} (includes inbox/other sources)`);
    if (manifest.last_run) {
      console.log(`  Last run: ${manifest.last_run}`);
    }
    manifest.last_status = {
      date: new Date().toISOString(),
      total_threads: threadIds.length,
      saved_files: savedFiles.size,
      pending,
    };
    await saveManifest(MANIFEST_PATH, manifest);
    console.log(`\n  Status saved to gmail/manifest.json`);
    return;
  }

  console.log('=== Email Backfill ===');
  const sinceMs = (!fullRun && manifest.last_run_ms) ? manifest.last_run_ms : 0;
  const useGmailDiscovery = sinceMs > 0 && !targetContact && !fullRun;

  if (useGmailDiscovery) {
    console.log(`  Incremental via Gmail API (zero BQ cost)`);
    console.log(`  Since: ${new Date(sinceMs).toISOString()}`);
  } else if (fullRun) {
    console.log(`  Mode: full via BigQuery (reprocessing all threads)`);
  } else if (targetContact) {
    console.log(`  Mode: single contact via BigQuery`);
  } else {
    console.log(`  Mode: initial backfill via BigQuery`);
  }
  console.log(`  Batch size: ${batchSize}`);

  let threadIds;
  let applyTsFilters = false;

  if (targetContact) {
    console.log('\nQuerying thread IDs from BigQuery...');
    threadIds = await getThreadIdsForContact(targetContact);
    console.log(`  Thread IDs for ${targetContact}: ${threadIds.length}`);
  } else if (useGmailDiscovery) {
    console.log('\nDiscovering new threads via Gmail API...');
    threadIds = await discoverViaGmailApi(sinceMs);
    applyTsFilters = true;
  } else {
    console.log('\nQuerying thread IDs from BigQuery...');
    threadIds = await getAllThreadIds(filters, sinceMs);
  }

  const savedFiles = await readDirIds(QMD_EMAILS_DIR);

  if (fullRun) {
    console.log(`  Reprocessing all ${threadIds.length} threads (--full)`);
  } else {
    threadIds = threadIds.filter(id => !savedFiles.has(id));
    console.log(`  Already saved: ${savedFiles.size}, Pending: ${threadIds.length}`);
  }

  if (threadIds.length === 0) {
    console.log('\nNothing to process. Run: qmd update');
    return;
  }

  const runStart = Date.now();
  const stats = { saved: 0, failed: 0, filtered: 0 };
  const total = threadIds.length;

  console.log(`\nFetching content in batches of ${batchSize}...`);
  if (applyTsFilters) {
    console.log(`  (applying sender/subject filters after fetch)`);
  }

  for (let i = 0; i < threadIds.length; i += batchSize) {
    const batch = threadIds.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(total / batchSize);

    process.stdout.write(`  Batch ${batchNum}/${totalBatches}: fetching via Gmail API...`);

    const threads = await fetchThreadBatch(batch);
    stats.failed += batch.length - threads.size;

    process.stdout.write(` writing ${threads.size} threads...`);

    for (const [threadId, row] of threads) {
      if (applyTsFilters && !threadPassesFilters(row, filters)) {
        stats.filtered++;
        continue;
      }

      try {
        const markdown = formatThreadMarkdown(row);
        await writeFile(`${QMD_EMAILS_DIR}/${threadId}.md`, markdown);
        stats.saved++;
      } catch (err) {
        stats.failed++;
        console.error(`\n  ✗ ${threadId}: ${err.message.slice(0, 60)}`);
      }
    }

    const elapsed = ((Date.now() - runStart) / 1000).toFixed(0);
    const done = i + batch.length;
    const rate = (stats.saved / (parseFloat(elapsed) || 1)).toFixed(1);
    const remaining = Math.round((total - done) / parseFloat(rate));
    console.log(
      ` done. Total: ${stats.saved} saved, ${stats.failed} failed | ${rate}/s | ~${remaining}s left`
    );
  }

  manifest.last_run = new Date().toISOString();
  manifest.last_run_ms = runStart;
  manifest.stats.total_indexed = savedFiles.size + stats.saved;
  manifest.stats.total_failed = stats.failed;
  await saveManifest(MANIFEST_PATH, manifest);

  console.log(`\n=== Done ===`);
  console.log(`Saved: ${stats.saved}, Failed: ${stats.failed}${stats.filtered > 0 ? `, Filtered: ${stats.filtered}` : ''}`);
  console.log(`Total files in context/gmail/: ${savedFiles.size + stats.saved}`);
  console.log(`\nRun: qmd update`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
