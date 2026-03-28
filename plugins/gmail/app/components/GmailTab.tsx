/**
 * GmailTab — self-contained iframe module for the Gmail plugin.
 *
 * This component runs in a sandboxed iframe via PluginFrame.
 * It fetches data from /api/gmail/items and uses window.selectItem()
 * to communicate with the parent.
 *
 * Does NOT import from @/ — all dependencies are self-contained or
 * resolved via the iframe's import map.
 */

import { useState, useEffect, useCallback } from "react"

interface ThreadSummary {
  id: string
  fromDisplay?: string
  from?: string
  subject?: string
  date?: string
  snippet?: string
  isUnread?: boolean
  isImportant?: boolean
  isStarred?: boolean
  labelIds?: string[]
}

interface QueryResult {
  items: ThreadSummary[]
  nextCursor?: string
}

// Declare global bridge functions injected by PluginFrame
declare const window: Window & {
  selectItem: (id: string) => void
  sendAction: (intent: string, data?: unknown) => void
  __reportHeight: () => void
}

function useEmails(q = "in:inbox") {
  const [threads, setThreads] = useState<ThreadSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<string | undefined>()

  const load = useCallback(async (cursor?: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ q })
      if (cursor) params.set("cursor", cursor)
      const res = await fetch(`/api/gmail/items?${params}`)
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      const data: QueryResult = await res.json()
      setThreads((prev) => cursor ? [...prev, ...data.items] : data.items)
      setNextCursor(data.nextCursor)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [q])

  useEffect(() => { load() }, [load])

  return { threads, loading, error, nextCursor, loadMore: () => load(nextCursor) }
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return ""
  try {
    const d = new Date(dateStr)
    const now = new Date()
    const isToday = d.toDateString() === now.toDateString()
    if (isToday) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric" })
  } catch {
    return dateStr
  }
}

function ThreadRow({
  thread,
  selected,
  onClick,
}: {
  thread: ThreadSummary
  selected: boolean
  onClick: () => void
}) {
  const from = thread.fromDisplay || thread.from || "(unknown)"
  const subject = thread.subject || "(no subject)"
  const date = formatDate(thread.date)

  return (
    <div
      onClick={onClick}
      style={{
        padding: "10px 16px",
        borderBottom: "1px solid var(--border)",
        cursor: "pointer",
        backgroundColor: selected
          ? "var(--primary)"
          : thread.isUnread
          ? "var(--card)"
          : "transparent",
        color: selected ? "var(--primary-foreground)" : "var(--foreground)",
        display: "flex",
        flexDirection: "column",
        gap: "2px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span
          style={{
            fontSize: "13px",
            fontWeight: thread.isUnread ? 600 : 400,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
        >
          {from}
        </span>
        <span
          style={{
            fontSize: "11px",
            opacity: 0.7,
            flexShrink: 0,
            marginLeft: "8px",
            color: selected ? "var(--primary-foreground)" : "var(--muted-foreground)",
          }}
        >
          {date}
        </span>
      </div>
      <div
        style={{
          fontSize: "12px",
          fontWeight: thread.isUnread ? 600 : 400,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {subject}
      </div>
      {thread.snippet && (
        <div
          style={{
            fontSize: "12px",
            opacity: 0.6,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: selected ? "var(--primary-foreground)" : "var(--muted-foreground)",
          }}
        >
          {thread.snippet}
        </div>
      )}
    </div>
  )
}

export default function GmailTab() {
  const { threads, loading, error, nextCursor, loadMore } = useEmails("in:inbox")
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id)
    window.selectItem(id)
  }, [])

  if (error) {
    return (
      <div style={{ padding: "16px", color: "var(--destructive)", fontSize: "13px" }}>
        Failed to load emails: {error}
      </div>
    )
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        backgroundColor: "var(--background)",
        overflow: "hidden",
      }}
    >
      {loading && threads.length === 0 ? (
        <div style={{ padding: "16px", color: "var(--muted-foreground)", fontSize: "13px" }}>
          Loading emails...
        </div>
      ) : (
        <>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {threads.map((thread) => (
              <ThreadRow
                key={thread.id}
                thread={thread}
                selected={thread.id === selectedId}
                onClick={() => handleSelect(thread.id)}
              />
            ))}
            {threads.length === 0 && !loading && (
              <div style={{ padding: "16px", color: "var(--muted-foreground)", fontSize: "13px" }}>
                No emails found.
              </div>
            )}
          </div>
          {nextCursor && (
            <button
              onClick={loadMore}
              style={{
                padding: "8px",
                border: "none",
                borderTop: "1px solid var(--border)",
                background: "var(--muted)",
                cursor: "pointer",
                fontSize: "12px",
                color: "var(--muted-foreground)",
              }}
            >
              Load more
            </button>
          )}
        </>
      )}
    </div>
  )
}
