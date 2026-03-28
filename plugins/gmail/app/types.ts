/**
 * Gmail plugin types — client-side.
 * These types describe parsed Gmail API responses as used by the UI.
 */

export interface GmailAttachment {
  attachmentId: string
  filename: string
  mimeType: string
  size: number
}

export interface GmailMessage {
  id: string
  threadId: string
  labelIds: string[]
  snippet: string
  from: string
  to: string
  subject: string
  date: string
  body: string
  bodyFormat: "markdown" | "plain"
  isUnread: boolean
  attachments: GmailAttachment[]
}

export interface GmailThread {
  id: string
  messages: GmailMessage[]
  subject: string
  snippet: string
  from: string
  date: string
  messageCount: number
  isUnread: boolean
  labelIds: string[]
}

export interface GmailLabel {
  id: string
  name: string
  type: string
  messagesTotal?: number
  messagesUnread?: number
}
