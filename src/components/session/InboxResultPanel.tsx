import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Button, Badge } from "@hammies/frontend/components/ui"
import { RichTextEditor } from "@/components/shared/RichTextEditor"
import { CheckCircle2, FileText, ExternalLink, Loader2 } from "lucide-react"
import { createDraft, updateTask } from "@/api/client"
import type { InboxResultData } from "@/types"

interface InboxResultPanelProps {
  data: InboxResultData
  sessionId: string
}

type ActionState = "idle" | "pending" | "success" | "error"

export function InboxResultPanel({ data }: InboxResultPanelProps) {
  const qc = useQueryClient()

  switch (data.action) {
    case "draft":
      return <DraftResult data={data} />
    case "task":
      return <TaskResult data={data} qc={qc} />
    case "context_updated":
      return <ContextUpdatedResult data={data} />
    case "skipped":
    default:
      return <SkippedResult data={data} />
  }
}

function DraftResult({ data }: { data: InboxResultData }) {
  const draft = data.draft!
  const [body, setBody] = useState(draft.body)
  const [state, setState] = useState<ActionState>("idle")

  async function handleSend() {
    setState("pending")
    try {
      await createDraft({
        to: draft.to,
        subject: draft.subject,
        body,
        threadId: draft.threadId ?? undefined,
        inReplyTo: draft.inReplyTo ?? undefined,
      })
      setState("success")
    } catch {
      setState("error")
    }
  }

  if (state === "success") {
    return (
      <div className="border rounded-lg mx-3 my-2 p-3 flex items-center gap-2 text-sm text-muted-foreground bg-muted/20">
        <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
        Draft saved — review and send from Gmail
      </div>
    )
  }

  return (
    <div className="border rounded-lg mx-3 my-2 overflow-hidden text-sm">
      <div className="px-3 py-2 border-b bg-muted/20 space-y-1">
        <div className="flex gap-2">
          <span className="text-muted-foreground w-14 shrink-0">To</span>
          <span className="truncate">{draft.to}</span>
        </div>
        <div className="flex gap-2">
          <span className="text-muted-foreground w-14 shrink-0">Subject</span>
          <span className="truncate">{draft.subject}</span>
        </div>
      </div>
      <div className="p-2">
        <RichTextEditor
          value={body}
          onChange={setBody}
          className="min-h-[200px] max-h-[400px]"
        />
      </div>
      <div className="px-3 pb-3 flex items-center gap-2">
        <Button
          size="sm"
          onClick={handleSend}
          disabled={state === "pending"}
        >
          {state === "pending" ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
          Save Draft
        </Button>
        {state === "error" && (
          <span className="text-xs text-destructive">Failed to save draft</span>
        )}
      </div>
    </div>
  )
}

function TaskResult({ data, qc }: { data: InboxResultData; qc: ReturnType<typeof useQueryClient> }) {
  const task = data.task!
  const [state, setState] = useState<ActionState>("idle")

  async function handleComplete() {
    setState("pending")
    try {
      await updateTask(task.id, { Status: { status: { name: "Done" } } })
      qc.invalidateQueries({ queryKey: ["tasks"] })
      setState("success")
    } catch {
      setState("error")
    }
  }

  return (
    <div className="border rounded-lg mx-3 my-2 p-3 text-sm space-y-3">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-medium leading-snug">{task.title}</div>
          {data.summary && (
            <div className="text-xs text-muted-foreground mt-1 leading-relaxed">{data.summary}</div>
          )}
        </div>
        <Badge variant="secondary" className="text-[10px] shrink-0">{task.status}</Badge>
      </div>
      <div className="flex items-center gap-2">
        {state === "success" ? (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            Marked as complete
          </div>
        ) : (
          <Button
            size="sm"
            onClick={handleComplete}
            disabled={state === "pending"}
          >
            {state === "pending" ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
            Mark Complete
          </Button>
        )}
        <a
          href={task.url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ExternalLink className="h-3 w-3" />
          Open in Notion
        </a>
        {state === "error" && (
          <span className="text-xs text-destructive">Failed to update task</span>
        )}
      </div>
    </div>
  )
}

function ContextUpdatedResult({ data }: { data: InboxResultData }) {
  return (
    <div className="border rounded-lg mx-3 my-2 p-3 text-sm">
      <div className="flex items-center gap-2 mb-2 font-medium">
        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
        Context updated
      </div>
      {data.summary && (
        <p className="text-xs text-muted-foreground mb-2">{data.summary}</p>
      )}
      {data.contextUpdated && data.contextUpdated.length > 0 && (
        <ul className="space-y-0.5">
          {data.contextUpdated.map((file) => (
            <li key={file} className="text-xs font-mono text-muted-foreground">
              {file}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SkippedResult({ data }: { data: InboxResultData }) {
  if (!data.summary) return null
  return (
    <div className="mx-3 my-2 text-sm text-muted-foreground px-1">
      {data.summary}
    </div>
  )
}
