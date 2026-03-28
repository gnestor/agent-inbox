---
name: process-email
description: Process an email thread — summarize, draft replies, extract action items, or take actions
category: process
---

# Process Email

When the user asks to process, handle, respond to, or take action on an email thread, use this skill.

## Overview

You have access to the Gmail plugin tools which let you:
- Read email threads and individual messages
- Draft and send replies
- Archive, trash, star, or label threads
- Extract action items and follow-ups

## Workflow

1. **Read the thread** — Use the inbox tools to fetch the full thread
2. **Understand context** — Who sent it, what do they need, what's the history
3. **Determine action** — Summarize, reply, archive, extract tasks, etc.
4. **Execute** — Draft reply or take the requested action
5. **Confirm** — Show the user what was done

## Guidelines

- Always read the full thread before responding, not just the latest message
- Match the tone and formality of the thread
- For replies: keep them concise and actionable
- For newsletters/automated emails: suggest archiving unless they want a summary
- Extract explicit action items (deadlines, requests, follow-ups)

## Email Actions Available

- `archive` — Remove from inbox (keeps in All Mail)
- `trash` — Move to trash
- `star` / `unstar` — Star for follow-up
- `mark-important` / `mark-not-important`
- `send` — Send a reply (requires to, subject, body)
- `save-draft` — Save without sending
