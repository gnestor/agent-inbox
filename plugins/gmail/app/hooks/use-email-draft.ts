import { useRef } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { sendEmail, createDraft } from "../api"
import { toast } from "sonner"
import { useLocalDraft } from "@/hooks/use-local-draft"
import type { GmailThread } from "../types"

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
    const sentMessages = thread?.messages.filter((m) => !m.labelIds.includes("DRAFT"))
    const last = sentMessages?.[sentMessages.length - 1]
    if (!last || !thread) throw new Error("No thread loaded")

    // Reply-all: collect all recipients, deduplicate, exclude self.
    // Gmail threads the reply automatically when threadId + In-Reply-To are set.
    const userEmail = last.to?.split(",").find((e) => e.includes("@"))?.trim() || ""
    const allRecipients = new Set<string>()
    // Include original sender
    if (last.from) allRecipients.add(last.from.trim())
    // Include all To recipients
    if (last.to) last.to.split(",").forEach((e) => allRecipients.add(e.trim()))
    if (last.cc) last.cc.split(",").forEach((e) => allRecipients.add(e.trim()))
    // Remove self
    allRecipients.forEach((e) => {
      if (e.toLowerCase().includes(userEmail.toLowerCase()) && userEmail) allRecipients.delete(e)
    })
    const to = [...allRecipients].join(", ")

    // Use RFC 2822 Message-ID for In-Reply-To so non-Gmail clients thread correctly.
    // Build the References chain: prior references + the message we're replying to.
    const inReplyTo = last.messageId || last.id
    const references = [last.references, last.messageId].filter(Boolean).join(" ") || undefined
    // Don't prepend "Re:" — Gmail handles this automatically for threaded replies
    return { to, subject: thread.subject, inReplyTo, references }
  }

  const sendMutation = useMutation({
    mutationFn: () => {
      const meta = getReplyMeta()
      return sendEmail({ ...meta, body: bodyRef.current, threadId })
    },
    onSuccess: () => {
      setBody("")
      qc.invalidateQueries({ queryKey: ["plugin-item", "gmail", threadId] })
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
