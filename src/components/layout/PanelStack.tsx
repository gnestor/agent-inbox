import { useEffect, useRef, useState } from "react"
import { useLocation } from "react-router-dom"
import { useIsMobile } from "@hammies/frontend/hooks"
import { cn } from "@hammies/frontend/lib/utils"
import { EmailList } from "@/components/email/EmailList"
import { EmailThread } from "@/components/email/EmailThread"
import { TaskList } from "@/components/task/TaskList"
import { TaskDetail } from "@/components/task/TaskDetail"
import { SessionList } from "@/components/session/SessionList"
import { SessionView } from "@/components/session/SessionView"
import { NewSessionPanel } from "@/components/session/NewSessionPanel"

// ── Column types ────────────────────────────────────────────────────────────

type Column =
  | { type: "email-list"; key: string }
  | { type: "email-thread"; threadId: string; key: string }
  | { type: "task-list"; key: string }
  | { type: "task-detail"; taskId: string; key: string }
  | { type: "session-list"; key: string }
  | { type: "session"; sessionId: string; key: string }
  // Compose + live session pane, stable key so it stays mounted across navigation
  | { type: "new-session"; threadId?: string; taskId?: string; sessionId?: string; key: string }

function pathToColumns(pathname: string): Column[] {
  const parts = pathname.split("/").filter(Boolean)
  const columns: Column[] = []

  if (parts[0] === "inbox") {
    columns.push({ type: "email-list", key: "email-list" })
    if (parts[1]) {
      const threadId = decodeURIComponent(parts[1])
      columns.push({ type: "email-thread", threadId, key: `email-thread:${threadId}` })
      if (parts[2] === "session") {
        const sessionId = parts[3] !== "new" ? parts[3] : undefined
        // Stable key: keyed by thread so the panel stays mounted when session is created
        columns.push({
          type: "new-session",
          threadId,
          sessionId,
          key: `new-session:thread:${threadId}`,
        })
      }
    }
  } else if (parts[0] === "tasks") {
    columns.push({ type: "task-list", key: "task-list" })
    if (parts[1]) {
      const taskId = decodeURIComponent(parts[1])
      columns.push({ type: "task-detail", taskId, key: `task-detail:${taskId}` })
      if (parts[2] === "session") {
        const sessionId = parts[3] !== "new" ? parts[3] : undefined
        columns.push({
          type: "new-session",
          taskId,
          sessionId,
          key: `new-session:task:${taskId}`,
        })
      }
    }
  } else if (parts[0] === "sessions") {
    columns.push({ type: "session-list", key: "session-list" })
    if (parts[1]) {
      columns.push({ type: "session", sessionId: parts[1], key: `session:${parts[1]}` })
    }
  }

  return columns
}

// ── Column content ──────────────────────────────────────────────────────────

function ColumnContent({
  col,
  selectedKeys,
}: {
  col: Column
  selectedKeys: Record<string, string | undefined>
}) {
  switch (col.type) {
    case "email-list":
      return <EmailList selectedThreadId={selectedKeys.threadId} />
    case "email-thread":
      return <EmailThread threadId={col.threadId} />
    case "task-list":
      return <TaskList selectedTaskId={selectedKeys.taskId} />
    case "task-detail":
      return <TaskDetail taskId={col.taskId} />
    case "session-list":
      return <SessionList selectedSessionId={selectedKeys.sessionId} />
    case "session":
      return <SessionView sessionId={col.sessionId} />
    case "new-session":
      return (
        <NewSessionPanel
          threadId={col.threadId}
          taskId={col.taskId}
          sessionId={col.sessionId}
        />
      )
  }
}

// ── Animated column wrapper ─────────────────────────────────────────────────

function AnimatedColumn({
  isNew,
  isExiting,
  isMobile,
  zIndex,
  children,
  colRef,
}: {
  isNew: boolean
  isExiting: boolean
  isMobile: boolean
  zIndex: number
  children: React.ReactNode
  colRef: (el: HTMLDivElement | null) => void
}) {
  const [entered, setEntered] = useState(!isNew)

  useEffect(() => {
    if (!isNew) return
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setEntered(true))
    })
  }, [])

  return (
    <div
      ref={colRef}
      style={{ zIndex }}
      className={cn(
        "shrink-0 h-full bg-card rounded-lg shadow-sm ring-1 ring-border overflow-hidden transition-[opacity,transform] duration-200 ease-out",
        isMobile ? "w-screen" : "w-[600px]",
        !entered && "opacity-0 translate-x-full",
        isExiting && "opacity-0 -translate-x-full",
      )}
    >
      {children}
    </div>
  )
}

// ── PanelStack ──────────────────────────────────────────────────────────────

export function PanelStack() {
  const location = useLocation()
  const isMobile = useIsMobile()

  const [columns, setColumns] = useState<Column[]>(() => pathToColumns(location.pathname))
  const prevColsRef = useRef(columns)
  const [newKeys, setNewKeys] = useState<Set<string>>(new Set())
  const [exitingKeys, setExitingKeys] = useState<Set<string>>(new Set())
  const [exiting, setExiting] = useState(false)

  const colRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  useEffect(() => {
    const next = pathToColumns(location.pathname)
    const prevCols = prevColsRef.current
    const prevKeys = new Set(prevCols.map((c) => c.key))
    const nextKeys = new Set(next.map((c) => c.key))

    // Detect root tab switch (first column type changes)
    const rootChanged =
      prevCols.length > 0 && next.length > 0 && prevCols[0].type !== next[0].type

    if (rootChanged) {
      setExiting(true)
      const timer = setTimeout(() => {
        setColumns(next)
        setNewKeys(new Set(next.map((c) => c.key)))
        prevColsRef.current = next
        setExiting(false)
      }, 180)
      return () => clearTimeout(timer)
    }

    // Detect removed columns (navigating back / closing a panel)
    const removedCols = prevCols.filter((c) => !nextKeys.has(c.key))
    if (removedCols.length > 0) {
      const removedKeys = new Set(removedCols.map((c) => c.key))
      // Keep removed columns rendered (appended) so they can animate out
      setColumns([...next, ...removedCols])
      setExitingKeys(removedKeys)
      prevColsRef.current = next
      const addedKeys = new Set(next.map((c) => c.key).filter((k) => !prevKeys.has(k)))
      setNewKeys(addedKeys)
      const timer = setTimeout(() => {
        setColumns(next)
        setExitingKeys(new Set())
      }, 210)
      return () => clearTimeout(timer)
    }

    const addedKeys = new Set(next.map((c) => c.key).filter((k) => !prevKeys.has(k)))
    setColumns(next)
    setNewKeys(addedKeys)
    prevColsRef.current = next
  }, [location.pathname])

  // Auto-scroll to rightmost non-exiting column
  useEffect(() => {
    if (columns.length === 0 || exiting) return
    const visibleCols = columns.filter((c) => !exitingKeys.has(c.key))
    if (visibleCols.length === 0) return
    const lastKey = visibleCols[visibleCols.length - 1].key
    const el = colRefs.current.get(lastKey)
    el?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "end" })
  }, [columns, exiting, exitingKeys])

  // Selected IDs for list highlighting
  const parts = location.pathname.split("/").filter(Boolean)
  const selectedKeys: Record<string, string | undefined> = {
    threadId: parts[0] === "inbox" && parts[1] ? decodeURIComponent(parts[1]) : undefined,
    taskId: parts[0] === "tasks" && parts[1] ? decodeURIComponent(parts[1]) : undefined,
    sessionId:
      parts[0] === "sessions" && parts[1]
        ? parts[1]
        : parts[2] === "session" && parts[3] && parts[3] !== "new"
          ? parts[3]
          : undefined,
  }

  if (columns.length === 0) return null

  return (
    <div
      className={cn(
        "flex flex-row h-full gap-4",
        isMobile ? "overflow-x-hidden p-0" : "overflow-x-auto py-4 pr-4 pl-0.5",
      )}
    >
      {columns.map((col, i) => (
        <AnimatedColumn
          key={col.key}
          isNew={newKeys.has(col.key)}
          isExiting={exiting || exitingKeys.has(col.key)}
          isMobile={isMobile}
          zIndex={columns.length - i}
          colRef={(el) => {
            if (el) colRefs.current.set(col.key, el)
            else colRefs.current.delete(col.key)
          }}
        >
          <ColumnContent col={col} selectedKeys={selectedKeys} />
        </AnimatedColumn>
      ))}
    </div>
  )
}
