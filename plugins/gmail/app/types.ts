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
  cc?: string
  subject: string
  date: string
  /** RFC 2822 Message-ID header value (e.g. <foo@mail.gmail.com>) — used for In-Reply-To and References */
  messageId?: string
  /** RFC 2822 References header — space-separated chain of ancestor message IDs */
  references?: string
  body: string
  bodyFormat: 'markdown' | 'plain'
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
