#!/usr/bin/env node
/**
 * Claude session transcript backfill — converts .jsonl session files to markdown
 * for qmd indexing at context/transcripts/{session-id}.md.
 *
 * Source: ~/.claude/projects/-Users-grant-Github-hammies-hammies-agent/*.jsonl
 * Output: context/transcripts/{session-id}.md
 *
 * Streams each file line-by-line to handle large files (some exceed 200 MB).
 * Extracts only human-readable content: user text (minus system XML) and
 * assistant text blocks (skips thinking, tool_use, tool_result).
 *
 * Usage:
 *   node workflows/context-backfill/transcripts/backfill.js
 *   node ... --status              # report counts
 *   node ... --dry-run             # preview without writing
 *   node ... --full                # reprocess already-saved sessions
 *   node ... --session-id <uuid>   # process a single session
 */

import 'dotenv/config';
import minimist from 'minimist';
import { readdir, stat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { REPO_ROOT, loadManifest, saveManifest, truncateArray, ensureDir, readDirIds } from '../lib/utils.js';

const args = minimist(process.argv.slice(2), {
  default: { 'session-id': '', status: false, 'dry-run': false, full: false },
  string: ['session-id'],
  boolean: ['status', 'dry-run', 'full'],
});

const CLAUDE_PROJECTS_DIR =
  `${homedir()}/.claude/projects/-Users-grant-Github-hammies-hammies-workspace-packages-agent`;
const TRANSCRIPTS_DIR = `${REPO_ROOT}/context/transcripts`;

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MANIFEST_PATH = resolve(__dirname, 'manifest.json');

// Truncation: keep first TURN_HEAD + last TURN_TAIL user/assistant exchange pairs.
const TURN_HEAD = 20;
const TURN_TAIL = 30;

// System-injected XML tags to strip from user messages.
const SYSTEM_TAG_RE =
  /<(ide_opened_file|ide_selection|ide_diagnostics|ide_diagnostics_output|command-name|system-reminder|antml:function_calls|task-notification)[^>]*>[\s\S]*?<\/\1>/g;

// ---------------------------------------------------------------------------
// JSONL streaming
// ---------------------------------------------------------------------------

async function* readJsonlLines(filePath) {
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line);
    } catch {
      // skip malformed lines
    }
  }
}

// ---------------------------------------------------------------------------
// Content extraction
// ---------------------------------------------------------------------------

function cleanUserText(content) {
  const parts = [];
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      const cleaned = block.text
        .replace(SYSTEM_TAG_RE, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      if (cleaned) parts.push(cleaned);
    }
  }
  return parts.join('\n\n').trim();
}

function cleanAssistantText(content) {
  const parts = [];
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      parts.push(block.text.trim());
    }
  }
  return parts.join('\n\n').trim();
}

// ---------------------------------------------------------------------------
// Session parsing
// ---------------------------------------------------------------------------

async function parseSession(filePath, sessionId) {
  const session = {
    sessionId,
    cwd: '',
    gitBranch: '',
    firstTimestamp: '',
    turns: [],
  };

  for await (const entry of readJsonlLines(filePath)) {
    const type = entry.type;

    if (type === 'user') {
      const timestamp = String(entry.timestamp ?? '');
      if (!session.firstTimestamp) session.firstTimestamp = timestamp;
      if (!session.cwd && entry.cwd) session.cwd = String(entry.cwd);
      if (!session.gitBranch && entry.gitBranch) session.gitBranch = String(entry.gitBranch);

      const msg = entry.message;
      const content = msg?.content ?? [];
      const text = cleanUserText(content);
      if (text) {
        session.turns.push({ role: 'user', timestamp, text });
      }
    } else if (type === 'assistant') {
      const timestamp = String(entry.timestamp ?? '');
      if (!session.firstTimestamp) session.firstTimestamp = timestamp;

      const msg = entry.message;
      const content = msg?.content ?? [];
      const text = cleanAssistantText(content);
      if (text) {
        session.turns.push({ role: 'assistant', timestamp, text });
      }
    }
  }

  if (session.turns.length === 0) return null;
  return session;
}

// ---------------------------------------------------------------------------
// Markdown formatting
// ---------------------------------------------------------------------------

function buildMarkdown(session) {
  const date = session.firstTimestamp
    ? session.firstTimestamp.slice(0, 10)
    : 'unknown';

  const { items: displayTurns, skipped } = truncateArray(session.turns, TURN_HEAD, TURN_TAIL);
  const truncated = skipped > 0;

  const frontmatter = [
    '---',
    'type: claude-transcript',
    `session-id: ${session.sessionId}`,
    `cwd: ${session.cwd || '/Users/grant/Github/hammies/hammies-agent'}`,
    `date: ${date}`,
    `turns: ${session.turns.length}`,
    `git-branch: ${session.gitBranch || 'master'}`,
    `truncated: ${truncated}`,
    '---',
    '',
  ].join('\n');

  const parts = [];

  if (skipped > 0) {
    for (const turn of displayTurns.slice(0, TURN_HEAD)) {
      parts.push(renderTurn(turn));
    }
    parts.push(`\n*[… ${skipped} turns omitted …]*\n`);
    for (const turn of displayTurns.slice(TURN_HEAD)) {
      parts.push(renderTurn(turn));
    }
  } else {
    for (const turn of displayTurns) {
      parts.push(renderTurn(turn));
    }
  }

  return {
    markdown: frontmatter + parts.join('\n'),
    truncated,
  };
}

function renderTurn(turn) {
  const label = turn.role === 'user' ? '**User**' : '**Assistant**';
  return `${label} · ${turn.timestamp}\n\n${turn.text}\n\n---\n`;
}

const DEFAULT_MANIFEST = {
  version: 1,
  last_run: null,
  stats: { total_saved: 0, total_skipped: 0, total_failed: 0 },
  sessions: {},
};

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

async function discoverSessions() {
  const entries = await readdir(CLAUDE_PROJECTS_DIR);
  return entries
    .filter(name => name.endsWith('.jsonl'))
    .map(name => name.replace(/\.jsonl$/, ''))
    .sort();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  await ensureDir(TRANSCRIPTS_DIR);
  const manifest = await loadManifest(MANIFEST_PATH, DEFAULT_MANIFEST);

  console.log(`Discovering sessions in ${CLAUDE_PROJECTS_DIR}...`);
  const allSessions = await discoverSessions();
  console.log(`  Found ${allSessions.length} sessions`);

  let pending;
  if (args['session-id']) {
    if (!allSessions.includes(args['session-id'])) {
      console.error(`Session ${args['session-id']} not found`);
      process.exit(1);
    }
    pending = [args['session-id']];
  } else if (args.full) {
    pending = allSessions;
  } else {
    const savedIds = await readDirIds(TRANSCRIPTS_DIR);
    pending = allSessions.filter(id => !savedIds.has(id));
  }

  const alreadySaved = allSessions.length - (args.full ? 0 : pending.length);

  if (args.status) {
    console.log('\nStatus:');
    console.log(`  Total sessions:    ${allSessions.length}`);
    console.log(`  Already saved:     ${alreadySaved}`);
    console.log(`  Pending:           ${pending.length}`);
    console.log(`  Manifest last run: ${manifest.last_run ?? 'never'}`);
    return;
  }

  if (pending.length === 0) {
    console.log('Nothing to do — all sessions already saved.');
    return;
  }

  if (args['dry-run']) {
    console.log(`\nDry run — would process ${pending.length} sessions:`);
    for (const id of pending.slice(0, 20)) {
      const info = await stat(`${CLAUDE_PROJECTS_DIR}/${id}.jsonl`);
      console.log(`  ${id}  (${(info.size / 1024 / 1024).toFixed(1)} MB)`);
    }
    if (pending.length > 20) console.log(`  ... and ${pending.length - 20} more`);
    return;
  }

  console.log(`\nProcessing ${pending.length} sessions...`);

  let saved = 0;
  let skippedStubs = 0;
  let failed = 0;

  for (const sessionId of pending) {
    const filePath = `${CLAUDE_PROJECTS_DIR}/${sessionId}.jsonl`;
    try {
      const session = await parseSession(filePath, sessionId);
      if (!session) {
        skippedStubs++;
        manifest.stats.total_skipped++;
        continue;
      }

      const { markdown, truncated } = buildMarkdown(session);
      await writeFile(`${TRANSCRIPTS_DIR}/${sessionId}.md`, markdown);

      manifest.sessions[sessionId] = {
        saved_at: new Date().toISOString(),
        turns: session.turns.length,
        truncated,
      };
      saved++;

      if (saved % 10 === 0) {
        console.log(`  ${saved}/${pending.length - skippedStubs} saved...`);
        await saveManifest(MANIFEST_PATH, manifest);
      }
    } catch (err) {
      console.error(`  Failed ${sessionId}: ${err}`);
      failed++;
    }
  }

  manifest.stats.total_saved += saved;
  manifest.stats.total_failed += failed;
  await saveManifest(MANIFEST_PATH, manifest);

  console.log(`\nDone. Saved: ${saved}, Skipped (stubs): ${skippedStubs}, Failed: ${failed}`);
  if (saved > 0) {
    console.log('\nRun to re-index:');
    console.log('  qmd update && qmd embed');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
