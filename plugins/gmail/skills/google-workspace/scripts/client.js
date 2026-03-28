#!/usr/bin/env node
// Run with: node .claude/skills/google-workspace/scripts/client.js <command>

import 'dotenv/config'
import { writeFile, readFile } from 'node:fs/promises';
import { getGoogleAccessToken } from './google-auth.js';

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1';
const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const SHEETS_BASE = 'https://sheets.googleapis.com/v4';
const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';

function success(data) {
  console.log(JSON.stringify(data, null, 2));
  process.exit(0);
}
function fail(err) {
  console.error(JSON.stringify({ success: false, error: String(err?.message ?? err) }, null, 2));
  process.exit(1);
}

// --- Helpers ---

function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

async function googleFetch(url, opts = {}) {
  const token = await getGoogleAccessToken();
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...opts.headers,
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? JSON.stringify(data));
  return data;
}

// Returns the raw Response (for file downloads)
async function googleFetchRaw(url, opts = {}) {
  const token = await getGoogleAccessToken();
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${token}`,
      ...opts.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res;
}

function buildUrl(base, path, params) {
  const url = new URL(`${base}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  return url.toString();
}

function decodeBase64Url(data) {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf-8');
}

function encodeBase64Url(str) {
  return Buffer.from(str, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function getHeader(message, name) {
  return message.payload?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

function getEmailBody(message) {
  const payload = message.payload;
  if (!payload) return '';

  // Direct body on payload
  if (payload.body?.data) return decodeBase64Url(payload.body.data);

  // Check parts
  if (payload.parts) {
    // Prefer text/plain
    const textPart = payload.parts.find(p => p.mimeType === 'text/plain');
    if (textPart?.body?.data) return decodeBase64Url(textPart.body.data);

    // Fall back to text/html with tag stripping
    const htmlPart = payload.parts.find(p => p.mimeType === 'text/html');
    if (htmlPart?.body?.data) {
      return decodeBase64Url(htmlPart.body.data)
        .replace(/<style[^>]*>.*?<\/style>/gs, '')
        .replace(/<script[^>]*>.*?<\/script>/gs, '')
        .replace(/<[^>]+>/g, '')
        .replace(/\n\s*\n/g, '\n\n')
        .trim();
    }

    // Check nested parts (e.g. multipart/alternative inside multipart/mixed)
    for (const part of payload.parts) {
      if (part.parts) {
        const sub = part.parts.find(p => p.mimeType === 'text/plain');
        if (sub?.body?.data) return decodeBase64Url(sub.body.data);
      }
    }
  }

  return message.snippet || '';
}

function extractSpreadsheetId(input) {
  const urlMatch = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (urlMatch) return urlMatch[1];
  return input;
}

function summarizeMessage(message) {
  return {
    id: message.id,
    threadId: message.threadId,
    subject: getHeader(message, 'Subject'),
    from: getHeader(message, 'From'),
    to: getHeader(message, 'To'),
    date: getHeader(message, 'Date'),
    snippet: message.snippet,
    labels: message.labelIds || [],
  };
}

// --- Gmail Commands ---

async function gmailSearch(flags) {
  if (!flags.query) throw new Error('--query is required');
  const maxResults = flags.max || '20';

  const list = await googleFetch(buildUrl(GMAIL_BASE, '/users/me/messages', { q: flags.query, maxResults }));

  if (!list.messages || list.messages.length === 0) {
    return { messages: [], resultSizeEstimate: list.resultSizeEstimate || 0 };
  }

  const messages = [];
  for (const msg of list.messages) {
    const full = await googleFetch(`${GMAIL_BASE}/users/me/messages/${msg.id}`);
    messages.push(summarizeMessage(full));
  }

  return { messages, resultSizeEstimate: list.resultSizeEstimate || messages.length };
}

async function gmailListUnread(flags) {
  const maxResults = flags.max || '20';

  const list = await googleFetch(buildUrl(GMAIL_BASE, '/users/me/messages', { q: 'is:unread', maxResults }));

  if (!list.messages || list.messages.length === 0) {
    return { messages: [], resultSizeEstimate: list.resultSizeEstimate || 0 };
  }

  const messages = [];
  for (const msg of list.messages) {
    const full = await googleFetch(`${GMAIL_BASE}/users/me/messages/${msg.id}`);
    messages.push(summarizeMessage(full));
  }

  return { messages, resultSizeEstimate: list.resultSizeEstimate || messages.length };
}

async function gmailGet(flags) {
  if (!flags.id) throw new Error('--id is required');

  const message = await googleFetch(`${GMAIL_BASE}/users/me/messages/${flags.id}`);

  return {
    id: message.id,
    threadId: message.threadId,
    subject: getHeader(message, 'Subject'),
    from: getHeader(message, 'From'),
    to: getHeader(message, 'To'),
    cc: getHeader(message, 'Cc'),
    bcc: getHeader(message, 'Bcc'),
    date: getHeader(message, 'Date'),
    snippet: message.snippet,
    labels: message.labelIds || [],
    body: getEmailBody(message),
  };
}

async function gmailSend(flags) {
  if (!flags.to) throw new Error('--to is required');
  if (!flags.subject) throw new Error('--subject is required');
  if (!flags.body) throw new Error('--body is required');

  const lines = [];
  lines.push(`To: ${flags.to}`);
  lines.push(`Subject: ${flags.subject}`);
  if (flags.cc) lines.push(`Cc: ${flags.cc}`);
  if (flags.bcc) lines.push(`Bcc: ${flags.bcc}`);
  if (flags['reply-to']) lines.push(`In-Reply-To: ${flags['reply-to']}`);
  if (flags['reply-to']) lines.push(`References: ${flags['reply-to']}`);
  lines.push('Content-Type: text/plain; charset="UTF-8"');
  lines.push('MIME-Version: 1.0');
  lines.push('');
  lines.push(flags.body);

  const rawMessage = lines.join('\r\n');
  const encoded = encodeBase64Url(rawMessage);

  const body = { raw: encoded };
  if (flags['reply-to']) {
    body.threadId = flags['thread-id'] || undefined;
  }

  const result = await googleFetch(`${GMAIL_BASE}/users/me/messages/send`, {
    method: 'POST',
    body,
  });

  return result;
}

async function gmailManageLabels(flags) {
  if (!flags.id) throw new Error('--id is required');
  if (!flags.add && !flags.remove) throw new Error('--add and/or --remove is required (comma-separated label names)');

  // Fetch all labels to resolve names to IDs
  const labelsResponse = await googleFetch(`${GMAIL_BASE}/users/me/labels`);
  const allLabels = labelsResponse.labels || [];

  // System labels that can be used directly by name
  const systemLabels = [
    'INBOX', 'SPAM', 'TRASH', 'UNREAD', 'STARRED', 'IMPORTANT',
    'SENT', 'DRAFT', 'CATEGORY_PERSONAL', 'CATEGORY_SOCIAL',
    'CATEGORY_PROMOTIONS', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS',
  ];

  function resolveLabelId(name) {
    const upper = name.trim().toUpperCase();
    if (systemLabels.includes(upper)) return upper;
    const found = allLabels.find(
      l => l.name.toLowerCase() === name.trim().toLowerCase(),
    );
    if (found) return found.id;
    throw new Error(`Label not found: "${name.trim()}"`);
  }

  const addLabelIds = [];
  const removeLabelIds = [];

  if (flags.add) {
    for (const name of flags.add.split(',')) {
      addLabelIds.push(resolveLabelId(name));
    }
  }
  if (flags.remove) {
    for (const name of flags.remove.split(',')) {
      removeLabelIds.push(resolveLabelId(name));
    }
  }

  const body = {};
  if (addLabelIds.length > 0) body.addLabelIds = addLabelIds;
  if (removeLabelIds.length > 0) body.removeLabelIds = removeLabelIds;

  const result = await googleFetch(`${GMAIL_BASE}/users/me/messages/${flags.id}/modify`, {
    method: 'POST',
    body,
  });

  return result;
}

async function gmailListImportant(flags) {
  const maxResults = flags.max || '20';
  const list = await googleFetch(buildUrl(GMAIL_BASE, '/users/me/messages', { q: 'is:important', maxResults }));
  if (!list.messages || list.messages.length === 0) return { messages: [], resultSizeEstimate: 0 };
  const messages = [];
  for (const msg of list.messages) {
    const full = await googleFetch(`${GMAIL_BASE}/users/me/messages/${msg.id}`);
    messages.push(summarizeMessage(full));
  }
  return { messages, resultSizeEstimate: list.resultSizeEstimate || messages.length };
}

async function gmailGetThread(flags) {
  if (!flags['thread-id']) throw new Error('--thread-id is required');
  const thread = await googleFetch(`${GMAIL_BASE}/users/me/threads/${flags['thread-id']}`);
  const messages = (thread.messages || []).map(msg => ({
    id: msg.id,
    subject: getHeader(msg, 'Subject'),
    from: getHeader(msg, 'From'),
    to: getHeader(msg, 'To'),
    date: getHeader(msg, 'Date'),
    messageId: getHeader(msg, 'Message-ID'),
    snippet: msg.snippet,
    body: getEmailBody(msg),
  }));
  return { threadId: thread.id, messages };
}

async function gmailListAttachments(flags) {
  if (!flags.id) throw new Error('--id is required');
  const message = await googleFetch(`${GMAIL_BASE}/users/me/messages/${flags.id}`);
  const attachments = [];
  function extractParts(parts) {
    for (const part of parts || []) {
      if (part.filename && part.body?.attachmentId) {
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType,
          attachmentId: part.body.attachmentId,
          size: part.body.size,
        });
      }
      if (part.parts) extractParts(part.parts);
    }
  }
  extractParts(message.payload?.parts);
  return { messageId: flags.id, attachments };
}

async function gmailGetAttachment(flags) {
  if (!flags.id) throw new Error('--id is required');
  if (!flags['attachment-id']) throw new Error('--attachment-id is required');
  if (!flags.output) throw new Error('--output is required (output file path)');
  const result = await googleFetch(`${GMAIL_BASE}/users/me/messages/${flags.id}/attachments/${flags['attachment-id']}`);
  const data = result.data.replace(/-/g, '+').replace(/_/g, '/');
  await writeFile(flags.output, Buffer.from(data, 'base64'));
  return { saved: true, path: flags.output, size: result.size };
}

async function gmailDeleteDraft(flags) {
  if (!flags.id) throw new Error('--id is required');
  const token = await getGoogleAccessToken();
  const res = await fetch(`${GMAIL_BASE}/users/me/drafts/${flags.id}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Delete failed: ${res.status} ${await res.text()}`);
  return { deleted: true, id: flags.id };
}

async function gmailCreateDraft(flags) {
  if (!flags.to) throw new Error('--to is required');
  if (!flags.subject) throw new Error('--subject is required');
  if (!flags.body) throw new Error('--body is required');

  const lines = [];
  lines.push(`To: ${flags.to}`);
  lines.push(`Subject: ${flags.subject}`);
  if (flags.cc) lines.push(`Cc: ${flags.cc}`);
  if (flags['in-reply-to']) lines.push(`In-Reply-To: ${flags['in-reply-to']}`);
  if (flags['in-reply-to']) lines.push(`References: ${flags['in-reply-to']}`);
  if (flags.html) {
    lines.push('Content-Type: multipart/alternative; boundary="boundary_alt"');
    lines.push('MIME-Version: 1.0');
    lines.push('');
    lines.push('--boundary_alt');
    lines.push('Content-Type: text/plain; charset="UTF-8"');
    lines.push('');
    lines.push(flags.body.replace(/<[^>]+>/g, ''));
    lines.push('--boundary_alt');
    lines.push('Content-Type: text/html; charset="UTF-8"');
    lines.push('');
    lines.push(flags.body);
    lines.push('--boundary_alt--');
  } else {
    lines.push('Content-Type: text/plain; charset="UTF-8"');
    lines.push('MIME-Version: 1.0');
    lines.push('');
    lines.push(flags.body);
  }

  const rawMessage = lines.join('\r\n');
  const encoded = encodeBase64Url(rawMessage);
  const body = { message: { raw: encoded } };
  if (flags['thread-id']) body.message.threadId = flags['thread-id'];

  return await googleFetch(`${GMAIL_BASE}/users/me/drafts`, { method: 'POST', body });
}

async function gmailListThreads(flags) {
  const maxResults = flags.max || '20';
  const params = { maxResults };
  if (flags.query) params.q = flags.query;
  const result = await googleFetch(buildUrl(GMAIL_BASE, '/users/me/threads', params));
  return result;
}

async function gmailBatchModify(flags) {
  if (!flags.ids) throw new Error('--ids is required (comma-separated message IDs)');
  if (!flags.add && !flags.remove) throw new Error('--add and/or --remove is required (comma-separated label names)');

  const labelsResponse = await googleFetch(`${GMAIL_BASE}/users/me/labels`);
  const allLabels = labelsResponse.labels || [];
  const systemLabels = ['INBOX','SPAM','TRASH','UNREAD','STARRED','IMPORTANT','SENT','DRAFT',
    'CATEGORY_PERSONAL','CATEGORY_SOCIAL','CATEGORY_PROMOTIONS','CATEGORY_UPDATES','CATEGORY_FORUMS'];

  function resolveLabelId(name) {
    const upper = name.trim().toUpperCase();
    if (systemLabels.includes(upper)) return upper;
    const found = allLabels.find(l => l.name.toLowerCase() === name.trim().toLowerCase());
    if (found) return found.id;
    throw new Error(`Label not found: "${name.trim()}"`);
  }

  const ids = flags.ids.split(',').map(s => s.trim());
  const addLabelIds = flags.add ? flags.add.split(',').map(resolveLabelId) : [];
  const removeLabelIds = flags.remove ? flags.remove.split(',').map(resolveLabelId) : [];

  const body = { ids };
  if (addLabelIds.length) body.addLabelIds = addLabelIds;
  if (removeLabelIds.length) body.removeLabelIds = removeLabelIds;

  await googleFetch(`${GMAIL_BASE}/users/me/messages/batchModify`, { method: 'POST', body });
  return { modified: ids.length, ids };
}

async function gmailListLabels() {
  return await googleFetch(`${GMAIL_BASE}/users/me/labels`);
}

async function gmailGetProfile() {
  return await googleFetch(`${GMAIL_BASE}/users/me/profile`);
}

// --- Drive Commands ---

async function driveSearch(flags) {
  if (!flags.query) throw new Error('--query is required');
  const pageSize = flags.limit || '20';

  const result = await googleFetch(buildUrl(DRIVE_BASE, '/files', {
    q: flags.query,
    pageSize,
    fields: 'files(id,name,mimeType,createdTime,modifiedTime,size,webViewLink,owners,parents,shared,starred)',
  }));

  return result;
}

async function driveList(flags) {
  if (!flags['folder-id']) throw new Error('--folder-id is required');
  const pageSize = flags.limit || '50';

  const result = await googleFetch(buildUrl(DRIVE_BASE, '/files', {
    q: `'${flags['folder-id']}' in parents and trashed = false`,
    pageSize,
    fields: 'files(id,name,mimeType,createdTime,modifiedTime,size,webViewLink,owners,parents,shared,starred)',
  }));

  return result;
}

async function driveDownload(flags) {
  if (!flags.id) throw new Error('--id is required');

  // Google Workspace MIME types that need export
  const exportMimeTypes = {
    'application/vnd.google-apps.document': 'text/plain',
    'application/vnd.google-apps.spreadsheet': 'text/csv',
    'application/vnd.google-apps.presentation': 'text/plain',
    'application/vnd.google-apps.drawing': 'image/png',
  };

  // First get file metadata to determine type
  const meta = await googleFetch(buildUrl(DRIVE_BASE, `/files/${flags.id}`, { fields: 'id,name,mimeType,size' }));

  const exportType = flags['mime-type'] || exportMimeTypes[meta.mimeType];

  let response;
  if (exportType) {
    // Export Google Workspace files
    response = await googleFetchRaw(buildUrl(DRIVE_BASE, `/files/${flags.id}/export`, { mimeType: exportType }));
  } else {
    // Download binary/regular files
    response = await googleFetchRaw(buildUrl(DRIVE_BASE, `/files/${flags.id}`, { alt: 'media' }));
  }

  const contentType = response.headers.get('content-type') || '';
  const isText = contentType.includes('text') || contentType.includes('json') || contentType.includes('xml') || contentType.includes('csv');

  if (isText) {
    const text = await response.text();
    return { id: meta.id, name: meta.name, mimeType: meta.mimeType, contentType, content: text };
  } else {
    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    return { id: meta.id, name: meta.name, mimeType: meta.mimeType, contentType, content_base64: base64 };
  }
}

async function driveUpload(flags) {
  if (!flags.name) throw new Error('--name is required');
  if (!flags.content) throw new Error('--content is required');

  const token = await getGoogleAccessToken();

  const metadata = { name: flags.name };
  if (flags['parent-id']) metadata.parents = [flags['parent-id']];
  if (flags['mime-type']) metadata.mimeType = flags['mime-type'];

  const boundary = '===multipart_boundary_' + Date.now() + '===';
  const contentType = flags['content-type'] || 'text/plain';

  const multipartBody = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${contentType}`,
    '',
    flags.content,
    `--${boundary}--`,
  ].join('\r\n');

  const res = await fetch(`${DRIVE_UPLOAD_BASE}/files?uploadType=multipart`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipartBody,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? JSON.stringify(data));
  return data;
}

async function driveGet(flags) {
  if (!flags.id) throw new Error('--id is required');
  return await googleFetch(buildUrl(DRIVE_BASE, `/files/${flags.id}`, {
    fields: 'id,name,mimeType,createdTime,modifiedTime,size,webViewLink,owners,parents,shared,starred,description,trashed',
  }));
}

async function driveUpdate(flags) {
  if (!flags.id) throw new Error('--id is required');
  if (!flags['file-path']) throw new Error('--file-path is required');
  const token = await getGoogleAccessToken();
  const content = await readFile(flags['file-path']);
  const mimeType = flags['mime-type'] || 'application/octet-stream';
  const res = await fetch(`${DRIVE_UPLOAD_BASE}/files/${flags.id}?uploadType=media`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': mimeType },
    body: content,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? JSON.stringify(data));
  return data;
}

async function driveUpdateMetadata(flags) {
  if (!flags.id) throw new Error('--id is required');
  if (!flags.body) throw new Error('--body is required (JSON object, e.g. \'{"name":"New Name"}\')');
  let body;
  try { body = JSON.parse(flags.body); } catch { throw new Error('--body must be valid JSON'); }
  return await googleFetch(`${DRIVE_BASE}/files/${flags.id}`, { method: 'PATCH', body });
}

async function driveCreateFolder(flags) {
  if (!flags.name) throw new Error('--name is required');
  const body = { name: flags.name, mimeType: 'application/vnd.google-apps.folder' };
  if (flags['parent-id']) body.parents = [flags['parent-id']];
  return await googleFetch(`${DRIVE_BASE}/files`, { method: 'POST', body });
}

async function driveMove(flags) {
  if (!flags.id) throw new Error('--id is required');
  if (!flags['parent-id']) throw new Error('--parent-id is required');
  const meta = await googleFetch(buildUrl(DRIVE_BASE, `/files/${flags.id}`, { fields: 'parents' }));
  const removeParents = (meta.parents || []).join(',');
  return await googleFetch(
    buildUrl(DRIVE_BASE, `/files/${flags.id}`, { addParents: flags['parent-id'], removeParents, fields: 'id,name,parents' }),
    { method: 'PATCH', body: {} },
  );
}

async function driveCopy(flags) {
  if (!flags.id) throw new Error('--id is required');
  const body = {};
  if (flags.name) body.name = flags.name;
  if (flags['parent-id']) body.parents = [flags['parent-id']];
  return await googleFetch(`${DRIVE_BASE}/files/${flags.id}/copy`, { method: 'POST', body });
}

async function driveTrash(flags) {
  if (!flags.id) throw new Error('--id is required');
  return await googleFetch(`${DRIVE_BASE}/files/${flags.id}`, { method: 'PATCH', body: { trashed: true } });
}

async function driveDelete(flags) {
  if (!flags.id) throw new Error('--id is required');
  const token = await getGoogleAccessToken();
  const res = await fetch(`${DRIVE_BASE}/files/${flags.id}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
  return { deleted: true };
}

async function driveShare(flags) {
  if (!flags.id) throw new Error('--id is required');
  if (!flags.role) throw new Error('--role is required (reader, writer, commenter, owner)');
  const type = flags.type || 'user';
  const body = { role: flags.role, type };
  if (type !== 'anyone') {
    if (!flags.email) throw new Error('--email is required for non-anyone permissions');
    body.emailAddress = flags.email;
  }
  return await googleFetch(`${DRIVE_BASE}/files/${flags.id}/permissions`, { method: 'POST', body });
}

async function driveListPermissions(flags) {
  if (!flags.id) throw new Error('--id is required');
  return await googleFetch(buildUrl(DRIVE_BASE, `/files/${flags.id}/permissions`, {
    fields: 'permissions(id,type,role,emailAddress,displayName,domain,expirationTime)',
  }));
}

async function driveRemovePermission(flags) {
  if (!flags.id) throw new Error('--id is required');
  if (!flags['permission-id']) throw new Error('--permission-id is required');
  const token = await getGoogleAccessToken();
  const res = await fetch(`${DRIVE_BASE}/files/${flags.id}/permissions/${flags['permission-id']}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
  return { deleted: true };
}

async function driveListRevisions(flags) {
  if (!flags.id) throw new Error('--id is required');
  return await googleFetch(buildUrl(DRIVE_BASE, `/files/${flags.id}/revisions`, {
    fields: 'revisions(id,modifiedTime,lastModifyingUser,size,keepForever)',
  }));
}

// --- Sheets Commands ---

async function sheetsList(flags) {
  if (!flags.id) throw new Error('--id is required (spreadsheet ID or URL)');
  const spreadsheetId = extractSpreadsheetId(flags.id);

  const result = await googleFetch(buildUrl(SHEETS_BASE, `/spreadsheets/${spreadsheetId}`, {
    fields: 'spreadsheetId,properties.title,sheets.properties',
  }));

  const sheets = (result.sheets || []).map(s => ({
    sheetId: s.properties.sheetId,
    title: s.properties.title,
    index: s.properties.index,
    sheetType: s.properties.sheetType,
    rowCount: s.properties.gridProperties?.rowCount,
    columnCount: s.properties.gridProperties?.columnCount,
  }));

  return {
    spreadsheetId: result.spreadsheetId,
    title: result.properties?.title,
    sheets,
  };
}

async function sheetsGetRange(flags) {
  if (!flags.id) throw new Error('--id is required (spreadsheet ID or URL)');
  if (!flags.range) throw new Error('--range is required (e.g. Sheet1!A1:D10)');
  const spreadsheetId = extractSpreadsheetId(flags.id);
  const valueRenderOption = flags['render-option'] || 'FORMATTED_VALUE';

  const result = await googleFetch(buildUrl(
    SHEETS_BASE,
    `/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(flags.range)}`,
    { valueRenderOption },
  ));

  return result;
}

async function sheetsUpdateRange(flags) {
  if (!flags.id) throw new Error('--id is required (spreadsheet ID or URL)');
  if (!flags.range) throw new Error('--range is required (e.g. Sheet1!A1:D10)');
  if (!flags.values) throw new Error('--values is required (JSON 2D array, e.g. \'[["a","b"],["c","d"]]\')');
  const spreadsheetId = extractSpreadsheetId(flags.id);
  const valueInputOption = flags['input-option'] || 'USER_ENTERED';

  let values;
  try {
    values = JSON.parse(flags.values);
  } catch {
    throw new Error('--values must be valid JSON (2D array)');
  }

  const result = await googleFetch(
    buildUrl(SHEETS_BASE, `/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(flags.range)}`, { valueInputOption }),
    { method: 'PUT', body: { range: flags.range, values } },
  );

  return result;
}

async function sheetsAppend(flags) {
  if (!flags.id) throw new Error('--id is required (spreadsheet ID or URL)');
  if (!flags.range) throw new Error('--range is required (e.g. Sheet1!A1:D1)');
  if (!flags.values) throw new Error('--values is required (JSON 2D array, e.g. \'[["a","b"],["c","d"]]\')');
  const spreadsheetId = extractSpreadsheetId(flags.id);
  const valueInputOption = flags['input-option'] || 'USER_ENTERED';
  const insertDataOption = flags['insert-option'] || 'INSERT_ROWS';

  let values;
  try {
    values = JSON.parse(flags.values);
  } catch {
    throw new Error('--values must be valid JSON (2D array)');
  }

  const result = await googleFetch(
    buildUrl(SHEETS_BASE, `/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(flags.range)}:append`, { valueInputOption, insertDataOption }),
    { method: 'POST', body: { range: flags.range, values } },
  );

  return result;
}

async function sheetsCreate(flags) {
  if (!flags.title) throw new Error('--title is required');

  const body = {
    properties: { title: flags.title },
  };

  if (flags['sheet-titles']) {
    body.sheets = flags['sheet-titles'].split(',').map(t => ({
      properties: { title: t.trim() },
    }));
  }

  const result = await googleFetch(`${SHEETS_BASE}/spreadsheets`, {
    method: 'POST',
    body,
  });

  return {
    spreadsheetId: result.spreadsheetId,
    spreadsheetUrl: result.spreadsheetUrl,
    title: result.properties?.title,
    sheets: (result.sheets || []).map(s => ({
      sheetId: s.properties.sheetId,
      title: s.properties.title,
    })),
  };
}

async function sheetsBatchGet(flags) {
  if (!flags.id) throw new Error('--id is required');
  if (!flags.ranges) throw new Error('--ranges is required (JSON array of range strings)');
  const spreadsheetId = extractSpreadsheetId(flags.id);
  let ranges;
  try { ranges = JSON.parse(flags.ranges); } catch { throw new Error('--ranges must be a valid JSON array'); }
  const valueRenderOption = flags['render-option'] || 'FORMATTED_VALUE';
  const url = new URL(`${SHEETS_BASE}/spreadsheets/${spreadsheetId}/values:batchGet`);
  for (const r of ranges) url.searchParams.append('ranges', r);
  url.searchParams.set('valueRenderOption', valueRenderOption);
  return await googleFetch(url.toString());
}

async function sheetsClear(flags) {
  if (!flags.id) throw new Error('--id is required');
  if (!flags.range) throw new Error('--range is required');
  const spreadsheetId = extractSpreadsheetId(flags.id);
  return await googleFetch(
    `${SHEETS_BASE}/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(flags.range)}:clear`,
    { method: 'POST', body: {} },
  );
}

async function sheetsBatchUpdate(flags) {
  if (!flags.id) throw new Error('--id is required');
  if (!flags.data) throw new Error('--data is required (JSON array of {range, values} objects)');
  const spreadsheetId = extractSpreadsheetId(flags.id);
  const valueInputOption = flags['input-option'] || 'USER_ENTERED';
  let data;
  try { data = JSON.parse(flags.data); } catch { throw new Error('--data must be valid JSON'); }
  return await googleFetch(
    buildUrl(SHEETS_BASE, `/spreadsheets/${spreadsheetId}/values:batchUpdate`, {}),
    { method: 'POST', body: { valueInputOption, data } },
  );
}

async function sheetsBatchClear(flags) {
  if (!flags.id) throw new Error('--id is required');
  if (!flags.ranges) throw new Error('--ranges is required (JSON array of range strings)');
  const spreadsheetId = extractSpreadsheetId(flags.id);
  let ranges;
  try { ranges = JSON.parse(flags.ranges); } catch { throw new Error('--ranges must be valid JSON'); }
  return await googleFetch(
    `${SHEETS_BASE}/spreadsheets/${spreadsheetId}/values:batchClear`,
    { method: 'POST', body: { ranges } },
  );
}

async function sheetsBatchUpdateSpreadsheet(flags) {
  if (!flags.id) throw new Error('--id is required');
  if (!flags.requests) throw new Error('--requests is required (JSON array of request objects)');
  const spreadsheetId = extractSpreadsheetId(flags.id);
  let requests;
  try { requests = JSON.parse(flags.requests); } catch { throw new Error('--requests must be valid JSON'); }
  return await googleFetch(
    `${SHEETS_BASE}/spreadsheets/${spreadsheetId}:batchUpdate`,
    { method: 'POST', body: { requests } },
  );
}

async function sheetsCopySheet(flags) {
  if (!flags.id) throw new Error('--id is required (source spreadsheet)');
  if (!flags['sheet-id']) throw new Error('--sheet-id is required (numeric sheet ID from sheets-list)');
  if (!flags['dest-id']) throw new Error('--dest-id is required (destination spreadsheet ID or URL)');
  const spreadsheetId = extractSpreadsheetId(flags.id);
  const destId = extractSpreadsheetId(flags['dest-id']);
  return await googleFetch(
    `${SHEETS_BASE}/spreadsheets/${spreadsheetId}/sheets/${flags['sheet-id']}:copyTo`,
    { method: 'POST', body: { destinationSpreadsheetId: destId } },
  );
}

async function sheetsGet(flags) {
  if (!flags.id) throw new Error('--id is required (spreadsheet ID or URL)');
  const spreadsheetId = extractSpreadsheetId(flags.id);
  const params = {};
  if (flags.ranges) params.ranges = flags.ranges;
  if (flags.fields) params.fields = flags.fields;
  return await googleFetch(buildUrl(SHEETS_BASE, `/spreadsheets/${spreadsheetId}`, params));
}

// --- Calendar Commands ---

async function calendarList(flags) {
  const calendarId = flags['calendar-id'] || 'primary';
  const maxResults = flags.max || '50';

  // Default to today if no dates specified
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  const timeMin = flags['time-min'] || startOfDay.toISOString();
  const timeMax = flags['time-max'] || endOfDay.toISOString();

  const result = await googleFetch(buildUrl(CALENDAR_BASE, `/calendars/${encodeURIComponent(calendarId)}/events`, {
    maxResults,
    singleEvents: 'true',
    orderBy: 'startTime',
    timeMin,
    timeMax,
  }));

  return result;
}

async function calendarCreate(flags) {
  const calendarId = flags['calendar-id'] || 'primary';

  if (!flags.summary) throw new Error('--summary is required');

  const event = {
    summary: flags.summary,
  };

  if (flags.description) event.description = flags.description;
  if (flags.location) event.location = flags.location;

  const timezone = flags.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

  // All-day event
  if (flags['start-date']) {
    event.start = { date: flags['start-date'] };
    event.end = { date: flags['end-date'] || flags['start-date'] };
  } else {
    // Timed event
    if (!flags.start) throw new Error('--start or --start-date is required');
    if (!flags.end) throw new Error('--end is required for timed events');
    event.start = { dateTime: flags.start, timeZone: timezone };
    event.end = { dateTime: flags.end, timeZone: timezone };
  }

  if (flags.attendees) {
    event.attendees = flags.attendees.split(',').map(email => ({ email: email.trim() }));
  }

  const result = await googleFetch(`${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    body: event,
  });

  return result;
}

async function calendarUpdate(flags) {
  const calendarId = flags['calendar-id'] || 'primary';
  if (!flags['event-id']) throw new Error('--event-id is required');

  const event = {};

  if (flags.summary) event.summary = flags.summary;
  if (flags.description) event.description = flags.description;
  if (flags.location) event.location = flags.location;

  const timezone = flags.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

  if (flags['start-date']) {
    event.start = { date: flags['start-date'] };
    if (flags['end-date']) event.end = { date: flags['end-date'] };
  } else if (flags.start) {
    event.start = { dateTime: flags.start, timeZone: timezone };
    if (flags.end) event.end = { dateTime: flags.end, timeZone: timezone };
  }

  if (flags.attendees) {
    event.attendees = flags.attendees.split(',').map(email => ({ email: email.trim() }));
  }

  const result = await googleFetch(`${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${flags['event-id']}`, {
    method: 'PATCH',
    body: event,
  });

  return result;
}

async function calendarDelete(flags) {
  const calendarId = flags['calendar-id'] || 'primary';
  if (!flags['event-id']) throw new Error('--event-id is required');

  const token = await getGoogleAccessToken();
  const res = await fetch(`${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${flags['event-id']}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` },
  });

  if (!res.ok && res.status !== 204) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  return { deleted: true };
}

async function calendarListCalendars() {
  return await googleFetch(`${CALENDAR_BASE}/users/me/calendarList`);
}

async function calendarGetCalendar(flags) {
  const calendarId = flags['calendar-id'] || 'primary';
  return await googleFetch(`${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}`);
}

async function calendarGetEvent(flags) {
  const calendarId = flags['calendar-id'] || 'primary';
  if (!flags['event-id']) throw new Error('--event-id is required');
  return await googleFetch(`${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${flags['event-id']}`);
}

async function calendarFreebusy(flags) {
  if (!flags['time-min']) throw new Error('--time-min is required (ISO 8601)');
  if (!flags['time-max']) throw new Error('--time-max is required (ISO 8601)');
  if (!flags.calendars) throw new Error('--calendars is required (comma-separated calendar IDs)');
  const items = flags.calendars.split(',').map(id => ({ id: id.trim() }));
  return await googleFetch(`${CALENDAR_BASE}/freeBusy`, {
    method: 'POST',
    body: { timeMin: flags['time-min'], timeMax: flags['time-max'], items },
  });
}

async function calendarQuickAdd(flags) {
  const calendarId = flags['calendar-id'] || 'primary';
  if (!flags.text) throw new Error('--text is required (natural language event description)');
  return await googleFetch(
    buildUrl(CALENDAR_BASE, `/calendars/${encodeURIComponent(calendarId)}/events/quickAdd`, { text: flags.text }),
    { method: 'POST', body: {} },
  );
}

async function calendarListInstances(flags) {
  const calendarId = flags['calendar-id'] || 'primary';
  if (!flags['event-id']) throw new Error('--event-id is required (recurring event ID)');
  const params = {};
  if (flags['time-min']) params.timeMin = flags['time-min'];
  if (flags['time-max']) params.timeMax = flags['time-max'];
  if (flags.max) params.maxResults = flags.max;
  return await googleFetch(buildUrl(
    CALENDAR_BASE,
    `/calendars/${encodeURIComponent(calendarId)}/events/${flags['event-id']}/instances`,
    params,
  ));
}

async function calendarMoveEvent(flags) {
  const calendarId = flags['calendar-id'] || 'primary';
  if (!flags['event-id']) throw new Error('--event-id is required');
  if (!flags.destination) throw new Error('--destination is required (destination calendar ID)');
  return await googleFetch(
    buildUrl(CALENDAR_BASE, `/calendars/${encodeURIComponent(calendarId)}/events/${flags['event-id']}/move`, {
      destination: flags.destination,
    }),
    { method: 'POST', body: {} },
  );
}

async function calendarColors() {
  return await googleFetch(`${CALENDAR_BASE}/colors`);
}

// --- CLI Router ---

const COMMANDS = {
  // Gmail
  'gmail-search': {
    fn: gmailSearch,
    desc: 'Search Gmail messages (--query) [--max]',
  },
  'gmail-list-unread': {
    fn: gmailListUnread,
    desc: 'List unread Gmail messages [--max]',
  },
  'gmail-get': {
    fn: gmailGet,
    desc: 'Get full email message with decoded body (--id)',
  },
  'gmail-send': {
    fn: gmailSend,
    desc: 'Send email (--to, --subject, --body) [--cc, --bcc, --reply-to, --thread-id]',
  },
  'gmail-manage-labels': {
    fn: gmailManageLabels,
    desc: 'Add/remove labels on a message (--id) [--add, --remove] (comma-separated label names)',
  },
  'gmail-list-important': {
    fn: gmailListImportant,
    desc: 'List important Gmail messages [--max]',
  },
  'gmail-get-thread': {
    fn: gmailGetThread,
    desc: 'Get all messages in a thread (--thread-id)',
  },
  'gmail-list-attachments': {
    fn: gmailListAttachments,
    desc: 'List attachments for a message (--id)',
  },
  'gmail-get-attachment': {
    fn: gmailGetAttachment,
    desc: 'Download an attachment to disk (--id, --attachment-id, --output)',
  },
  'gmail-delete-draft': {
    fn: gmailDeleteDraft,
    desc: 'Delete a draft email (--id)',
  },
  'gmail-create-draft': {
    fn: gmailCreateDraft,
    desc: 'Create a draft email (--to, --subject, --body) [--thread-id, --in-reply-to, --cc, --html]',
  },
  'gmail-list-threads': {
    fn: gmailListThreads,
    desc: 'List Gmail threads [--query, --max]',
  },
  'gmail-batch-modify': {
    fn: gmailBatchModify,
    desc: 'Batch add/remove labels on messages (--ids comma-separated) [--add, --remove]',
  },
  'gmail-list-labels': {
    fn: gmailListLabels,
    desc: 'List all Gmail labels',
  },
  'gmail-get-profile': {
    fn: gmailGetProfile,
    desc: 'Get Gmail account profile (email address, message count, etc.)',
  },

  // Drive
  'drive-search': {
    fn: driveSearch,
    desc: 'Search Drive files (--query) [--limit]',
  },
  'drive-list': {
    fn: driveList,
    desc: 'List files in a Drive folder (--folder-id) [--limit]',
  },
  'drive-download': {
    fn: driveDownload,
    desc: 'Download/export a Drive file (--id) [--mime-type]',
  },
  'drive-upload': {
    fn: driveUpload,
    desc: 'Upload a file to Drive (--name, --content) [--parent-id, --mime-type, --content-type]',
  },
  'drive-get': {
    fn: driveGet,
    desc: 'Get file metadata (--id)',
  },
  'drive-update': {
    fn: driveUpdate,
    desc: 'Update file content from local file (--id, --file-path) [--mime-type]',
  },
  'drive-update-metadata': {
    fn: driveUpdateMetadata,
    desc: 'Update file metadata (--id, --body JSON) e.g. rename, star, trash',
  },
  'drive-create-folder': {
    fn: driveCreateFolder,
    desc: 'Create a folder (--name) [--parent-id]',
  },
  'drive-move': {
    fn: driveMove,
    desc: 'Move file to a folder (--id, --parent-id)',
  },
  'drive-copy': {
    fn: driveCopy,
    desc: 'Copy a file (--id) [--name, --parent-id]',
  },
  'drive-trash': {
    fn: driveTrash,
    desc: 'Move file to trash (--id)',
  },
  'drive-delete': {
    fn: driveDelete,
    desc: 'Permanently delete a file (--id)',
  },
  'drive-share': {
    fn: driveShare,
    desc: 'Share a file (--id, --role, --email) [--type: user/group/anyone]',
  },
  'drive-list-permissions': {
    fn: driveListPermissions,
    desc: 'List permissions on a file (--id)',
  },
  'drive-remove-permission': {
    fn: driveRemovePermission,
    desc: 'Remove a permission from a file (--id, --permission-id)',
  },
  'drive-list-revisions': {
    fn: driveListRevisions,
    desc: 'List revision history for a file (--id)',
  },

  // Sheets
  'sheets-list': {
    fn: sheetsList,
    desc: 'List sheets/tabs in a spreadsheet (--id)',
  },
  'sheets-get-range': {
    fn: sheetsGetRange,
    desc: 'Get cell values from a range (--id, --range) [--render-option]',
  },
  'sheets-update-range': {
    fn: sheetsUpdateRange,
    desc: 'Update cell values in a range (--id, --range, --values JSON) [--input-option]',
  },
  'sheets-append': {
    fn: sheetsAppend,
    desc: 'Append rows to a sheet (--id, --range, --values JSON) [--input-option, --insert-option]',
  },
  'sheets-create': {
    fn: sheetsCreate,
    desc: 'Create a new spreadsheet (--title) [--sheet-titles comma-separated]',
  },
  'sheets-batch-get': {
    fn: sheetsBatchGet,
    desc: 'Get multiple ranges at once (--id, --ranges JSON array) [--render-option]',
  },
  'sheets-clear': {
    fn: sheetsClear,
    desc: 'Clear values from a range (--id, --range)',
  },
  'sheets-batch-update': {
    fn: sheetsBatchUpdate,
    desc: 'Update multiple ranges (--id, --data JSON [{range,values}]) [--input-option]',
  },
  'sheets-batch-clear': {
    fn: sheetsBatchClear,
    desc: 'Clear multiple ranges (--id, --ranges JSON array)',
  },
  'sheets-batch-update-spreadsheet': {
    fn: sheetsBatchUpdateSpreadsheet,
    desc: 'Apply formatting/structural changes (--id, --requests JSON array)',
  },
  'sheets-copy-sheet': {
    fn: sheetsCopySheet,
    desc: 'Copy a sheet to another spreadsheet (--id, --sheet-id, --dest-id)',
  },
  'sheets-get': {
    fn: sheetsGet,
    desc: 'Get full spreadsheet metadata and structure (--id) [--ranges, --fields]',
  },

  // Calendar
  'calendar-list': {
    fn: calendarList,
    desc: 'List calendar events [--calendar-id, --time-min, --time-max, --max]',
  },
  'calendar-create': {
    fn: calendarCreate,
    desc: 'Create calendar event (--summary) [--description, --location, --start, --end, --start-date, --end-date, --timezone, --attendees, --calendar-id]',
  },
  'calendar-update': {
    fn: calendarUpdate,
    desc: 'Update calendar event (--event-id) [--summary, --description, --location, --start, --end, --start-date, --end-date, --timezone, --attendees, --calendar-id]',
  },
  'calendar-delete': {
    fn: calendarDelete,
    desc: 'Delete calendar event (--event-id) [--calendar-id]',
  },
  'calendar-list-calendars': {
    fn: calendarListCalendars,
    desc: 'List all accessible calendars',
  },
  'calendar-get-calendar': {
    fn: calendarGetCalendar,
    desc: 'Get metadata for a calendar [--calendar-id, default: primary]',
  },
  'calendar-get-event': {
    fn: calendarGetEvent,
    desc: 'Get a specific event (--event-id) [--calendar-id]',
  },
  'calendar-freebusy': {
    fn: calendarFreebusy,
    desc: 'Query free/busy times (--time-min, --time-max, --calendars comma-separated IDs)',
  },
  'calendar-quick-add': {
    fn: calendarQuickAdd,
    desc: 'Create event from natural language (--text) [--calendar-id]',
  },
  'calendar-list-instances': {
    fn: calendarListInstances,
    desc: 'List instances of a recurring event (--event-id) [--calendar-id, --time-min, --time-max, --max]',
  },
  'calendar-move': {
    fn: calendarMoveEvent,
    desc: 'Move event to another calendar (--event-id, --destination) [--calendar-id]',
  },
  'calendar-colors': {
    fn: calendarColors,
    desc: 'Get available calendar and event color definitions',
  },
};

function printUsage() {
  console.log('Usage: client.js <command> [options]\n');
  console.log('Google Workspace CLI - Gmail, Drive, Sheets, Calendar\n');
  console.log('Commands:');
  const maxLen = Math.max(...Object.keys(COMMANDS).map(k => k.length));
  let lastCategory = '';
  for (const [name, { desc }] of Object.entries(COMMANDS)) {
    const category = name.split('-')[0];
    if (category !== lastCategory) {
      if (lastCategory) console.log('');
      console.log(`  ${category.charAt(0).toUpperCase() + category.slice(1)}:`);
      lastCategory = category;
    }
    console.log(`    ${name.padEnd(maxLen + 2)}${desc}`);
  }
}

async function main() {
  const required = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'];
  const missing = required.filter((v) => !process.env[v]);
  if (missing.length) fail(new Error(`Missing required env vars: ${missing.join(', ')}`));

  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || !COMMANDS[command]) {
    if (command) console.error(`Unknown command: ${command}\n`);
    printUsage();
    process.exit(command ? 1 : 0);
  }

  const flags = parseFlags(args.slice(1));

  try {
    const result = await COMMANDS[command].fn(flags);
    success(result);
  } catch (err) {
    fail(err);
  }
}

main();
