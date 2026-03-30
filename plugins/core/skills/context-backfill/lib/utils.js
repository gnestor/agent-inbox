/**
 * Shared utilities for context-backfill scripts.
 *
 * All scripts under workflows/context-backfill/{source}/backfill.js share
 * the same depth (3 levels below repo root), so REPO_ROOT is computed once here.
 */

import { readdir, readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { getGoogleAccessToken } from '../../../.claude/skills/google-workspace/scripts/google-auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const REPO_ROOT = resolve(__dirname, '../../..');

// ---------------------------------------------------------------------------
// BigQuery — direct REST API (no subprocess)
// ---------------------------------------------------------------------------

const BQ_BASE = 'https://bigquery.googleapis.com/bigquery/v2';
const DEFAULT_MAX_BYTES = 1 * 1024 * 1024 * 1024; // 1 GB

function parseBQRows(schema, rows) {
  return (rows || []).map(row => {
    const obj = {};
    schema.fields.forEach((field, i) => {
      obj[field.name] = row.f[i].v;
    });
    return obj;
  });
}

export async function runBQ(sql, maxBytes = DEFAULT_MAX_BYTES) {
  const token = await getGoogleAccessToken();
  const project = process.env.BIGQUERY_PROJECT;
  if (!project) throw new Error('BIGQUERY_PROJECT env var is required');

  const res = await fetch(`${BQ_BASE}/projects/${project}/queries`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: sql,
      useLegacySql: false,
      maxResults: 100000,
      maximumBytesBilled: String(maxBytes),
    }),
  });

  let response = await res.json();
  if (!res.ok) throw new Error(response.error?.message ?? JSON.stringify(response));

  // Poll for completion if job is not done
  if (!response.jobComplete) {
    const jobId = response.jobReference.jobId;
    const maxWaitMs = 5 * 60 * 1000;
    const pollIntervalMs = 2000;
    const startTime = Date.now();

    while (!response.jobComplete) {
      if (Date.now() - startTime > maxWaitMs) {
        throw new Error(`Query timed out after 5 minutes. Job ID: ${jobId}`);
      }
      await new Promise(r => setTimeout(r, pollIntervalMs));
      const pollRes = await fetch(
        `${BQ_BASE}/projects/${project}/queries/${jobId}?maxResults=100000`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      response = await pollRes.json();
      if (!pollRes.ok) throw new Error(response.error?.message ?? 'BQ poll failed');
    }
  }

  // Paginate if there are more results
  let allRows = response.rows || [];
  let pageToken = response.pageToken;

  while (pageToken) {
    const pageRes = await fetch(
      `${BQ_BASE}/projects/${project}/queries/${response.jobReference.jobId}?pageToken=${pageToken}&maxResults=100000`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const page = await pageRes.json();
    if (!pageRes.ok) throw new Error(page.error?.message ?? 'BQ pagination failed');
    allRows.push(...(page.rows || []));
    pageToken = page.pageToken;
  }

  const rows = response.schema ? parseBQRows(response.schema, allRows) : [];
  return { rows };
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

export async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

export async function fileExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Read a directory and return a Set of IDs (filenames without extension). */
export async function readDirIds(dir, ext = '.md') {
  const entries = await readdir(dir);
  return new Set(
    entries
      .filter(name => name.endsWith(ext))
      .map(name => name.slice(0, -ext.length)),
  );
}

// ---------------------------------------------------------------------------
// Manifest I/O
// ---------------------------------------------------------------------------

export async function loadManifest(path, defaultValue) {
  try {
    return JSON.parse(await readFile(path, 'utf-8'));
  } catch {
    return defaultValue;
  }
}

export async function saveManifest(path, manifest) {
  await writeFile(path, JSON.stringify(manifest, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Text processing
// ---------------------------------------------------------------------------

/** Normalize whitespace, decode HTML entities, collapse blank lines. */
export function cleanBody(text) {
  return text
    .replace(/\r\r\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Keep first `head` + last `tail` items, return skipped count. */
export function truncateArray(items, head, tail) {
  if (items.length <= head + tail) {
    return { items, skipped: 0 };
  }
  const skipped = items.length - head - tail;
  return {
    items: [...items.slice(0, head), ...items.slice(-tail)],
    skipped,
  };
}

