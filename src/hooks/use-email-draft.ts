import { useRef } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { sendEmail, createDraft } from "@/api/client"
import { toast } from "sonner"
import { useLocalDraft } from "./use-local-draft"
import type { GmailThread } from "@/types"

export type DraftPhase = "idle" | "sending" | "saving"

export function useEmailDraft(threadId: string, thread: GmailThread | undefined) {
  const draftKey = `inbox:reply-draft:${threadId}`
  const [body, setBody] = useLocalDraft(draftKey)
  const bodyRef = useRef(body)
  bodyRef.current = body
  const qc = useQueryClient()

  // Seed from Gmail draft if no local draft exists (render-time, no effect needed)
  const gmailDraft = thread?.messages.find((m) => m.labelIds.includes("DRAFT"))
  const seededRef = useRef(false)
  if (!seededRef.current && !body && gmailDraft?.body) {
    seededRef.current = true
    setBody(gmailDraft.body)
  }

  // Shared reply metadata — derived, not stored
  function getReplyMeta() {
    const last = thread?.messages[thread.messages.length - 1]
    if (!last || !thread) throw new Error("No thread loaded")
    const to = last.from
    const subject = thread.subject.startsWith("Re: ") ? thread.subject : `Re: ${thread.subject}`
    return { to, subject, inReplyTo: last.id }
  }

  const sendMutation = useMutation({
    mutationFn: () => {
      const meta = getReplyMeta()
      return sendEmail({ ...meta, body: bodyRef.current, threadId })
    },
    onSuccess: () => {
      setBody("")
      qc.invalidateQueries({ queryKey: ["thread", threadId] })
      qc.invalidateQueries({ queryKey: ["emails"] })
      toast.success("Reply sent")
    },
    onError: (err: Error) => toast.error(`Send failed: ${err.message}`),
  })

  const saveMutation = useMutation({
    mutationFn: () => {
      const meta = getReplyMeta()
      return createDraft({ ...meta, body: bodyRef.current, threadId })
    },
    onSuccess: () => toast.success("Draft saved"),
    onError: (err: Error) => toast.error(`Save draft failed: ${err.message}`),
  })

  const phase: DraftPhase =
    sendMutation.isPending ? "sending" :
    saveMutation.isPending ? "saving" :
    "idle"

  return {
    body,
    setBody,
    phase,
    send: () => sendMutation.mutate(),
    save: () => saveMutation.mutate(),
    hasGmailDraft: !!gmailDraft,
    canSubmit: phase === "idle" && !!body.trim(),
  }
}
