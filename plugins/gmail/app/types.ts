import { z } from "zod"

export const GmailAttachmentSchema = z.object({
  attachmentId: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  size: z.number(),
}).strict()

export const GmailMessageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  labelIds: z.array(z.string()),
  snippet: z.string(),
  from: z.string(),
  to: z.string(),
  cc: z.string().optional(),
  subject: z.string(),
  date: z.string(),
  /** RFC 2822 Message-ID header value (e.g. <foo@mail.gmail.com>) — used for In-Reply-To and References */
  messageId: z.string().optional(),
  /** RFC 2822 References header — space-separated chain of ancestor message IDs */
  references: z.string().optional(),
  body: z.string(),
  bodyFormat: z.enum(["markdown", "plain"]),
  isUnread: z.boolean(),
  attachments: z.array(GmailAttachmentSchema),
}).strict()

export const GmailThreadSchema = z.object({
  id: z.string(),
  messages: z.array(GmailMessageSchema),
  subject: z.string(),
  snippet: z.string(),
  from: z.string(),
  date: z.string(),
  messageCount: z.number().int().nonnegative(),
  isUnread: z.boolean(),
  labelIds: z.array(z.string()),
}).strict()

export const GmailThreadSummarySchema = z.object({
  id: z.string(),
  threadId: z.string(),
  historyId: z.string().optional(),
  messageCount: z.number().int().nonnegative(),
  subject: z.string(),
  from: z.string(),
  to: z.string(),
  date: z.string(),
  snippet: z.string(),
  isUnread: z.boolean(),
  isImportant: z.boolean(),
  isStarred: z.boolean(),
  labelIds: z.array(z.string()),
  labels: z.array(z.string()),
  body: z.string(),
}).strict()

export const GmailSearchResponseSchema = z.object({
  messages: z.array(GmailThreadSummarySchema),
  nextPageToken: z.string().nullable(),
}).strict()

export const GmailLabelSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  messagesTotal: z.number().optional(),
  messagesUnread: z.number().optional(),
}).strict()

export type GmailAttachment = z.infer<typeof GmailAttachmentSchema>
export type GmailMessage = z.infer<typeof GmailMessageSchema>
export type GmailThread = z.infer<typeof GmailThreadSchema>
export type GmailThreadSummary = z.infer<typeof GmailThreadSummarySchema>
export type GmailLabel = z.infer<typeof GmailLabelSchema>
