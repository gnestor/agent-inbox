#!/usr/bin/env node
/**
 * Gorgias context backfill — saves one markdown file per ticket to context/gorgias/.
 *
 * Uses a SINGLE combined BigQuery query to join tickets + messages in one pass.
 * Total scan: ~30 MB (tickets) + ~1.8 GB (messages) = ~1.86 GB regardless of
 * ticket count. Never batch-query the messages table — that multiplies cost.
 *
 * Usage:
 *   node workflows/context-backfill/gorgias/backfill.js
 *   node ... --status              # report counts without processing
 *   node ... --dry-run             # preview without writing
 *   node ... --full                # reprocess already-saved tickets
 *   node ... --ticket-id 12345     # process a single ticket
 *   node ... --since 2025-01-01    # only tickets created after date
 *   node ... --channel email       # only tickets from this channel
 */

import 'dotenv/config';
import minimist from 'minimist';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { REPO_ROOT, runBQ, cleanBody, loadManifest, saveManifest, truncateArray, readDirIds, ensureDir } from '../lib/utils.js';

const args = minimist(process.argv.slice(2), {
  default: {
    'ticket-id': '',
    status: false,
    'dry-run': false,
    full: false,
    since: '',
    channel: '',
  },
  string: ['ticket-id', 'since', 'channel'],
  boolean: ['status', 'dry-run', 'full'],
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const GORGIAS_DIR = `${REPO_ROOT}/context/gorgias`;
const MANIFEST_PATH = resolve(__dirname, 'manifest.json');

const BQ_MAX_BYTES = 10 * 1024 * 1024 * 1024;

const MSG_HEAD = 3;
const MSG_TAIL = 5;
const BODY_CAP = 20_000;

// ---------------------------------------------------------------------------
// BigQuery client — combined query
// ---------------------------------------------------------------------------

async function fetchAllTickets() {
  let whereExtra = '';
  if (args.since) {
    whereExtra += `\n      AND t.created_datetime >= TIMESTAMP('${args.since}')`;
  }
  if (args.channel) {
    whereExtra += `\n      AND t.channel = '${args.channel}'`;
  }
  if (args['ticket-id']) {
    whereExtra += `\n      AND t.id = ${Number(args['ticket-id'])}`;
  }

  const sql = `
    WITH latest_tickets AS (
      SELECT
        id,
        status,
        channel,
        COALESCE(customer.email, '') AS customer_email,
        COALESCE(customer.name,  '') AS customer_name,
        COALESCE(subject, '')         AS subject,
        COALESCE(messages_count, 0)   AS messages_count,
        created_datetime,
        ROW_NUMBER() OVER (PARTITION BY id ORDER BY _sdc_extracted_at DESC) AS rn
      FROM \`hammies.gorgias.tickets\`
      WHERE channel NOT IN ('phone', 'api', 'tiktok-shop')
        AND _sdc_deleted_at IS NULL
    ),
    tickets AS (
      SELECT * FROM latest_tickets WHERE rn = 1
    ),
    latest_messages AS (
      SELECT
        ticket_id,
        from_agent,
        COALESCE(source.from.name,    sender.name,  '') AS from_name,
        COALESCE(source.from.address, sender.email, '') AS from_address,
        COALESCE(
          NULLIF(TRIM(stripped_text), ''),
          NULLIF(TRIM(body_text),     ''),
          ''
        ) AS body,
        created_datetime AS msg_datetime,
        ROW_NUMBER() OVER (PARTITION BY id ORDER BY _sdc_extracted_at DESC) AS rn
      FROM \`hammies.gorgias.messages\`
      WHERE ticket_id IN (SELECT id FROM tickets)
        AND _sdc_deleted_at IS NULL
    ),
    messages AS (
      SELECT * FROM latest_messages WHERE rn = 1
    )
    SELECT
      CAST(t.id            AS STRING) AS ticket_id,
      t.status,
      t.channel,
      t.customer_email,
      t.customer_name,
      t.subject,
      t.messages_count,
      CAST(t.created_datetime   AS STRING) AS created_at,
      CAST(m.from_agent         AS STRING) AS from_agent,
      m.from_name,
      m.from_address,
      m.body,
      CAST(m.msg_datetime       AS STRING) AS msg_at
    FROM tickets t
    LEFT JOIN messages m ON m.ticket_id = t.id
    WHERE 1=1${whereExtra}
    ORDER BY t.id, m.msg_datetime
  `;

  const { rows } = await runBQ(sql, BQ_MAX_BYTES);

  const ticketMap = new Map();

  for (const r of rows) {
    const tid = String(r.ticket_id ?? '');
    if (!ticketMap.has(tid)) {
      ticketMap.set(tid, {
        id: tid,
        status:          String(r.status         ?? ''),
        channel:         String(r.channel        ?? ''),
        customer_email:  String(r.customer_email ?? ''),
        customer_name:   String(r.customer_name  ?? ''),
        subject:         String(r.subject        ?? ''),
        messages_count:  Number(r.messages_count ?? 0),
        created_at:      String(r.created_at     ?? ''),
        messages: [],
      });
    }

    if (r.msg_at) {
      ticketMap.get(tid).messages.push({
        from_agent:    r.from_agent === 'true',
        from_name:     String(r.from_name    ?? ''),
        from_address:  String(r.from_address ?? ''),
        body:          String(r.body         ?? ''),
        msg_at:        String(r.msg_at       ?? ''),
      });
    }
  }

  return ticketMap;
}

// ---------------------------------------------------------------------------
// Markdown formatting
// ---------------------------------------------------------------------------

function formatSender(msg) {
  if (msg.from_name && msg.from_address) return `${msg.from_name} <${msg.from_address}>`;
  return msg.from_address || msg.from_name || (msg.from_agent ? 'Support' : 'Customer');
}

function buildMarkdown(ticket) {
  const customerDisplay = ticket.customer_name
    ? `${ticket.customer_name} <${ticket.customer_email}>`
    : ticket.customer_email || 'unknown';

  const header = [
    '---',
    'type: gorgias-ticket',
    `ticket-id: ${ticket.id}`,
    `channel: ${ticket.channel}`,
    `status: ${ticket.status}`,
    `customer: "${customerDisplay.replace(/"/g, '\\"')}"`,
    `subject: "${ticket.subject.replace(/"/g, '\\"')}"`,
    `created: ${ticket.created_at}`,
    `messages: ${ticket.messages.length}`,
    '---',
    '',
    `**Customer:** ${customerDisplay}`,
    `**Status:** ${ticket.status}  **Channel:** ${ticket.channel}`,
    '',
  ].join('\n');

  const { items: display, skipped } = truncateArray(ticket.messages, MSG_HEAD, MSG_TAIL);

  const renderMsg = (m) => [
    '---',
    '',
    `**From:** ${formatSender(m)}`,
    `**Date:** ${m.msg_at}`,
    '',
    cleanBody(m.body.slice(0, BODY_CAP)),
    '',
  ].join('\n');

  const parts = [];
  if (skipped > 0) {
    display.slice(0, MSG_HEAD).forEach((m) => parts.push(renderMsg(m)));
    parts.push(`\n*[… ${skipped} messages omitted …]*\n`);
    display.slice(MSG_HEAD).forEach((m) => parts.push(renderMsg(m)));
  } else {
    display.forEach((m) => parts.push(renderMsg(m)));
  }

  return header + parts.join('\n');
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

const DEFAULT_MANIFEST = {
  version: 1,
  last_run: null,
  stats: { total_saved: 0, total_failed: 0 },
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  await ensureDir(GORGIAS_DIR);

  const manifest = await loadManifest(MANIFEST_PATH, DEFAULT_MANIFEST);

  console.log('Running combined BQ query (tickets + messages, ~1.9 GB scan)...');
  const ticketMap = await fetchAllTickets();
  console.log(`  Loaded ${ticketMap.size} tickets from BigQuery`);

  const savedFiles = await readDirIds(GORGIAS_DIR);

  const allTickets = [...ticketMap.values()];
  let pending;

  if (args['ticket-id']) {
    const target = ticketMap.get(String(args['ticket-id']));
    if (!target) {
      console.error(`Ticket ${args['ticket-id']} not found in BigQuery`);
      process.exit(1);
    }
    pending = [target];
  } else if (args.full) {
    pending = allTickets;
  } else {
    pending = allTickets.filter(t => !savedFiles.has(t.id));
  }

  const alreadySaved = allTickets.length - pending.length;

  if (args.status) {
    console.log('\nStatus:');
    console.log(`  Total tickets:     ${allTickets.length}`);
    console.log(`  Already saved:     ${alreadySaved}`);
    console.log(`  Pending:           ${pending.length}`);
    console.log(`  Manifest last run: ${manifest.last_run ?? 'never'}`);
    console.log(`  Manifest saved:    ${manifest.stats.total_saved}`);
    return;
  }

  if (pending.length === 0) {
    console.log('Nothing to do — all tickets already saved.');
    return;
  }

  if (args['dry-run']) {
    console.log(`\nDry run — would write ${pending.length} files:`);
    for (const t of pending.slice(0, 20)) {
      console.log(`  #${t.id.padEnd(8)} [${t.channel}] ${t.subject || '(no subject)'} (${t.messages.length} msgs)`);
    }
    if (pending.length > 20) console.log(`  ... and ${pending.length - 20} more`);
    return;
  }

  console.log(`\nWriting ${pending.length} ticket files...`);

  let saved = 0;
  let failed = 0;

  for (const ticket of pending) {
    try {
      await writeFile(`${GORGIAS_DIR}/${ticket.id}.md`, buildMarkdown(ticket));
      saved++;
      if (saved % 1000 === 0) {
        console.log(`  ${saved + alreadySaved}/${allTickets.length} saved...`);
        await saveManifest(MANIFEST_PATH, manifest);
      }
    } catch (err) {
      console.error(`  Failed #${ticket.id}: ${err}`);
      failed++;
    }
  }

  manifest.stats.total_saved += saved;
  manifest.stats.total_failed += failed;
  await saveManifest(MANIFEST_PATH, manifest);

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
