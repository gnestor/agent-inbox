#!/usr/bin/env node
/**
 * Slack context backfill — saves one markdown file per channel to context/slack/.
 *
 * The hammies.slack BigQuery dataset is tiny (<2 MB total). A single combined
 * query fetches messages, thread replies, channel metadata, and user names.
 * No batching or cost concerns — BQ cap set to 50 MB.
 *
 * Usage:
 *   node workflows/context-backfill/slack/backfill.js
 *   node ... --status              # list channels + message counts
 *   node ... --dry-run             # preview without writing
 *   node ... --full                # overwrite existing files
 *   node ... --channel-id C03QJNGJCS2
 */

import 'dotenv/config';
import minimist from 'minimist';
import { writeFile } from 'node:fs/promises';
import { REPO_ROOT, runBQ, ensureDir, readDirIds } from '../lib/utils.js';

const args = minimist(process.argv.slice(2), {
  default: { 'channel-id': '', status: false, 'dry-run': false, full: false },
  string: ['channel-id'],
  boolean: ['status', 'dry-run', 'full'],
});

const SLACK_DIR = `${REPO_ROOT}/context/slack`;

const BQ_MAX_BYTES = 50 * 1024 * 1024;

// ---------------------------------------------------------------------------
// BigQuery fetch
// ---------------------------------------------------------------------------

async function fetchAllData() {
  const channelFilter = args['channel-id']
    ? `AND channel_id = '${args['channel-id']}'`
    : '';

  const sql = `
    WITH latest_messages AS (
      SELECT *,
        ROW_NUMBER() OVER (PARTITION BY channel_id, ts ORDER BY _sdc_extracted_at DESC) AS rn
      FROM \`hammies.slack.messages\`
      WHERE _sdc_deleted_at IS NULL
        AND (subtype IS NULL OR subtype NOT IN (
          'channel_join', 'channel_leave', 'channel_archive',
          'bot_message', 'channel_name', 'channel_purpose', 'channel_topic'
        ))
        AND bot_id IS NULL
        AND text IS NOT NULL AND TRIM(text) != ''
        ${channelFilter}
    ),
    latest_threads AS (
      SELECT *,
        ROW_NUMBER() OVER (PARTITION BY channel_id, ts ORDER BY _sdc_extracted_at DESC) AS rn
      FROM \`hammies.slack.threads\`
      WHERE _sdc_deleted_at IS NULL
        AND text IS NOT NULL AND TRIM(text) != ''
        ${channelFilter}
    ),
    latest_users AS (
      SELECT *,
        ROW_NUMBER() OVER (PARTITION BY id ORDER BY _sdc_extracted_at DESC) AS rn
      FROM \`hammies.slack.users\`
    ),
    latest_channels AS (
      SELECT *,
        ROW_NUMBER() OVER (PARTITION BY id ORDER BY _sdc_extracted_at DESC) AS rn
      FROM \`hammies.slack.channels\`
    )
    SELECT
      m.channel_id,
      COALESCE(c.name, m.channel_id) AS channel_name,
      COALESCE(c.topic.value, '') AS channel_topic,
      COALESCE(c.purpose.value, '') AS channel_purpose,
      m.ts,
      m.thread_ts,
      'message' AS source,
      m.text,
      COALESCE(m.user, '') AS user_id,
      COALESCE(u.real_name, m.user, 'Unknown') AS user_name,
      CAST(COALESCE(m.reply_count, 0) AS STRING) AS reply_count
    FROM latest_messages m
    LEFT JOIN latest_channels c ON c.id = m.channel_id AND c.rn = 1
    LEFT JOIN latest_users   u ON u.id = m.user        AND u.rn = 1
    WHERE m.rn = 1

    UNION ALL

    SELECT
      t.channel_id,
      COALESCE(c.name, t.channel_id) AS channel_name,
      COALESCE(c.topic.value, '') AS channel_topic,
      COALESCE(c.purpose.value, '') AS channel_purpose,
      t.ts,
      t.thread_ts,
      'thread' AS source,
      t.text,
      COALESCE(t.user, '') AS user_id,
      COALESCE(u.real_name, t.user, 'Unknown') AS user_name,
      NULL AS reply_count
    FROM latest_threads t
    LEFT JOIN latest_channels c ON c.id = t.channel_id AND c.rn = 1
    LEFT JOIN latest_users   u ON u.id = t.user        AND u.rn = 1
    WHERE t.rn = 1
      AND t.thread_ts != t.ts

    ORDER BY channel_id, ts
  `;

  const { rows } = await runBQ(sql, BQ_MAX_BYTES);
  return rows.map((r) => ({
    channel_id:      String(r.channel_id      ?? ''),
    channel_name:    String(r.channel_name    ?? ''),
    channel_topic:   String(r.channel_topic   ?? ''),
    channel_purpose: String(r.channel_purpose ?? ''),
    ts:              String(r.ts              ?? ''),
    thread_ts:       r.thread_ts != null ? String(r.thread_ts) : null,
    source:          String(r.source ?? 'message'),
    text:            String(r.text            ?? ''),
    user_id:         String(r.user_id         ?? ''),
    user_name:       String(r.user_name       ?? 'Unknown'),
    reply_count:     r.reply_count != null ? String(r.reply_count) : null,
  }));
}

// ---------------------------------------------------------------------------
// Build channel map
// ---------------------------------------------------------------------------

function buildChannels(rows) {
  const userNames = new Map();
  for (const r of rows) {
    if (r.user_id && r.user_name !== 'Unknown') {
      userNames.set(r.user_id, r.user_name);
    }
  }

  const msgMap = new Map();
  const channels = new Map();

  for (const r of rows) {
    if (!r.channel_id) continue;

    if (!channels.has(r.channel_id)) {
      channels.set(r.channel_id, {
        id: r.channel_id,
        name: r.channel_name,
        topic: r.channel_topic,
        purpose: r.channel_purpose,
        messages: [],
        lastTs: r.ts,
      });
    }
    const ch = channels.get(r.channel_id);
    if (r.ts > ch.lastTs) ch.lastTs = r.ts;

    const msg = {
      ts: r.ts,
      thread_ts: r.thread_ts,
      source: r.source,
      text: resolveUserMentions(r.text, userNames),
      user_id: r.user_id,
      user_name: r.user_name,
      reply_count: parseInt(r.reply_count ?? '0', 10) || 0,
      replies: [],
    };

    if (r.source === 'message') {
      ch.messages.push(msg);
      msgMap.set(`${r.channel_id}:${r.ts}`, msg);
    } else if (r.thread_ts) {
      const parentKey = `${r.channel_id}:${r.thread_ts}`;
      const parent = msgMap.get(parentKey);
      if (parent) {
        parent.replies.push(msg);
      } else {
        ch.messages.push(msg);
      }
    }
  }

  return channels;
}

function resolveUserMentions(text, userNames) {
  return text.replace(/<@([A-Z0-9]+)>/g, (_, uid) => {
    const name = userNames.get(uid);
    return name ? `@${name}` : `<@${uid}>`;
  });
}

// ---------------------------------------------------------------------------
// Markdown formatting
// ---------------------------------------------------------------------------

function tsToDatetime(ts) {
  const ms = parseFloat(ts) * 1000;
  if (isNaN(ms)) return ts;
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 16);
}

function renderMessage(msg, indent = '') {
  const dt = tsToDatetime(msg.ts);
  const lines = [];

  if (indent) {
    lines.push(`${indent}**${msg.user_name}** · ${dt}`);
    for (const line of msg.text.split('\n')) {
      lines.push(`${indent}${line}`);
    }
  } else {
    lines.push(`**${msg.user_name}** · ${dt}`);
    lines.push(msg.text);
  }

  for (const reply of msg.replies) {
    lines.push('');
    lines.push(...renderMessage(reply, '  └ ').split('\n'));
  }

  return lines.join('\n');
}

function buildMarkdown(channel) {
  const lastDt = tsToDatetime(channel.lastTs);
  const msgCount = channel.messages.reduce(
    (acc, m) => acc + 1 + m.replies.length,
    0,
  );

  const topicLine = channel.topic?.trim()
    ? `**Topic:** ${channel.topic.trim()}\n\n`
    : '';

  const header = [
    '---',
    'type: slack-channel',
    `channel-id: ${channel.id}`,
    `channel-name: ${channel.name || channel.id}`,
    channel.topic ? `topic: "${channel.topic.replace(/"/g, '\\"').trim()}"` : '',
    `messages: ${msgCount}`,
    `last-message: ${lastDt}`,
    '---',
    '',
    `# #${channel.name || channel.id}`,
    '',
  ]
    .filter((l) => l !== '')
    .join('\n');

  const body = topicLine +
    channel.messages
      .map((m) => renderMessage(m))
      .join('\n\n---\n\n');

  return header + '\n\n' + body + '\n';
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  await ensureDir(SLACK_DIR);

  console.log('Running combined BQ query (messages + threads + channels + users, <2 MB)...');
  const rows = await fetchAllData();
  console.log(`  Loaded ${rows.length} rows from BigQuery`);

  const channels = buildChannels(rows);
  const activeChannels = [...channels.values()].filter((c) => c.messages.length > 0);

  if (args.status) {
    console.log(`\nChannels with messages: ${activeChannels.length}`);
    for (const ch of activeChannels.sort((a, b) => b.messages.length - a.messages.length)) {
      const total = ch.messages.reduce((acc, m) => acc + 1 + m.replies.length, 0);
      console.log(`  #${(ch.name || ch.id).padEnd(30)} ${String(total).padStart(4)} msgs  last: ${tsToDatetime(ch.lastTs)}`);
    }
    return;
  }

  let pending;
  if (args.full || args['channel-id']) {
    pending = activeChannels;
  } else {
    const savedIds = await readDirIds(SLACK_DIR);
    pending = activeChannels.filter((ch) => !savedIds.has(ch.id));
  }

  if (args['dry-run']) {
    console.log(`\nDry run — would write ${pending.length} channel file(s):`);
    for (const ch of pending) {
      const total = ch.messages.reduce((acc, m) => acc + 1 + m.replies.length, 0);
      console.log(`  #${ch.name || ch.id} (${total} msgs) → context/slack/${ch.id}.md`);
    }
    return;
  }

  if (pending.length === 0) {
    console.log('Nothing to do — all channel files already exist. Use --full to overwrite.');
    return;
  }

  console.log(`\nWriting ${pending.length} channel file(s)...`);
  let saved = 0;
  let failed = 0;

  for (const ch of pending) {
    try {
      await writeFile(`${SLACK_DIR}/${ch.id}.md`, buildMarkdown(ch));
      const total = ch.messages.reduce((acc, m) => acc + 1 + m.replies.length, 0);
      console.log(`  #${ch.name || ch.id} (${total} msgs) → ${ch.id}.md`);
      saved++;
    } catch (err) {
      console.error(`  Failed #${ch.name || ch.id}: ${err}`);
      failed++;
    }
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
