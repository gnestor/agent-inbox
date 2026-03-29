// Structural types for the subset of Gmail API responses this codebase uses.
// These are NOT complete Gmail API types — just the fields we access.

export interface GmailApiHeader {
  name: string
  value: string
}

export interface GmailApiBody {
  data?: string
  attachmentId?: string
  size?: number
}

export interface GmailApiPart {
  mimeType: string
  filename?: string
  headers?: GmailApiHeader[]
  body?: GmailApiBody
  parts?: GmailApiPart[]
}

/** A full Gmail message as returned by messages.get with format=full */
export interface GmailApiMessage {
  id: string
  threadId: string
  labelIds?: string[]
  snippet?: string
  historyId?: string
  payload?: GmailApiPart
}

/** A Gmail thread as returned by threads.get */
export interface GmailApiThread {
  id: string
  historyId?: string
  messages?: GmailApiMessage[]
}

/** Individual history event from history.list */
export interface GmailApiHistoryEvent {
  messagesAdded?: Array<{ message: { id: string; threadId: string; labelIds?: string[] } }>
  messagesDeleted?: Array<{ message: { id: string; threadId: string; labelIds?: string[] } }>
  labelsAdded?: Array<{ message: { id: string; threadId: string; labelIds?: string[] } }>
  labelsRemoved?: Array<{ message: { id: string; threadId: string; labelIds?: string[] } }>
}

/** Response from history.list */
export interface GmailApiHistoryResponse {
  historyId?: string
  history?: GmailApiHistoryEvent[]
}

/** A thread list item (minimal — only has id) */
export interface GmailApiThreadRef {
  id: string
}

/** Response from threads.list */
export interface GmailApiThreadListResponse {
  threads?: GmailApiThreadRef[]
  nextPageToken?: string
  historyId?: string
}

/** Response from messages.list */
export interface GmailApiMessageListResponse {
  messages?: Array<{ id: string; threadId: string }>
  nextPageToken?: string
}

/** Gmail label */
export interface GmailApiLabel {
  id: string
  name: string
  type: string
  messagesTotal?: number
  messagesUnread?: number
}

/** Send-as setting */
export interface GmailApiSendAs {
  isPrimary?: boolean
  signature?: string
}
