import { useMutation, useQueryClient } from "@tanstack/react-query"
import { resumeSession, abortSession, archiveSession, unarchiveSession, updateSession } from "@/api/client"
import { toast } from "sonner"
import type { Session, SessionStatus } from "@/types"
import { createLogger } from "@/lib/logger"
import { useSessionStore } from "@/stores/session-store"

const log = createLogger("session-mutations")

interface SessionListCache { sessions: Session[] }

interface UseSessionMutationsOptions {
  sessionId: string
  onResume?: () => void
  onArchive?: () => void
}

type QC = ReturnType<typeof useQueryClient>

function setSessionListStatus(qc: QC, sessionId: string, status: SessionStatus) {
  qc.setQueriesData<SessionListCache>({ queryKey: ["sessions"] }, (old) => {
    if (!old?.sessions) return old
    return { ...old, sessions: old.sessions.map((s) => (s.id === sessionId ? { ...s, status } : s)) }
  })
}

function setSessionListSummary(qc: QC, sessionId: string, summary: string) {
  qc.setQueriesData<SessionListCache>({ queryKey: ["sessions"] }, (old) => {
    if (!old?.sessions) return old
    return { ...old, sessions: old.sessions.map((s) => (s.id === sessionId ? { ...s, summary } : s)) }
  })
}

/** Shared optimistic update pattern: cancel in-flight → set status → invalidate on settle → rollback on error */
function optimisticStatusSwitch(
  qc: QC,
  sessionId: string,
  target: SessionStatus,
  rollback: SessionStatus,
) {
  return {
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ["sessions"] })
      useSessionStore.getState().setSessionStatus(sessionId, target)
      setSessionListStatus(qc, sessionId, target)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["sessions"] })
    },
    onError: (err: Error) => {
      useSessionStore.getState().setSessionStatus(sessionId, rollback)
      setSessionListStatus(qc, sessionId, rollback)
      log.error("Failed to update session status", { sessionId, target, error: err.message })
    },
  }
}

export function useSessionMutations({ sessionId, onResume, onArchive }: UseSessionMutationsOptions) {
  const qc = useQueryClient()

  // resume — the store already flipped status to "running" via submitOptimisticPrompt
  // in useSessionController, so here we only need to keep the sessions list in sync
  // and handle the error rollback.
  const resume = useMutation({
    mutationFn: (prompt: string) => resumeSession(sessionId, prompt),
    onMutate: () => {
      setSessionListStatus(qc, sessionId, "running")
    },
    onSuccess: (result) => {
      onResume?.()
      qc.invalidateQueries({ queryKey: ["sessions"] })
      if (result?.queued) {
        toast.info("Message queued — will send after current turn finishes")
      }
    },
    onError: (err: Error) => {
      log.error("Failed to resume session", { sessionId, error: err.message })
      useSessionStore.getState().setSessionStatus(sessionId, "complete")
      setSessionListStatus(qc, sessionId, "complete")
      toast.error(`Failed to resume session: ${err.message}`)
    },
    // No onSettled detail refetch — the store is the source of truth and WS
    // events drive final status. A refetch here would race with in-flight
    // JSONL writes.
  })

  const abort = useMutation({
    mutationFn: () => abortSession(sessionId),
    onMutate: () => {
      useSessionStore.getState().setSessionStatus(sessionId, "complete")
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sessions"] })
    },
    onError: (err: Error) => log.error("Failed to abort session", { sessionId, error: err.message }),
  })

  const archiveOpts = optimisticStatusSwitch(qc, sessionId, "archived", "complete")
  const archive = useMutation({
    mutationFn: () => archiveSession(sessionId),
    onMutate: async () => {
      await archiveOpts.onMutate()
      onArchive?.()
    },
    onSettled: archiveOpts.onSettled,
    onError: archiveOpts.onError,
  })

  const unarchive = useMutation({
    mutationFn: () => unarchiveSession(sessionId),
    ...optimisticStatusSwitch(qc, sessionId, "complete", "archived"),
  })

  const rename = useMutation({
    mutationFn: (newTitle: string) => updateSession(sessionId, { summary: newTitle }),
    onMutate: async (newTitle: string) => {
      await qc.cancelQueries({ queryKey: ["sessions"] })
      const slice = useSessionStore.getState().sessions[sessionId]
      const prior: { summary: string | null } | null = slice ? { summary: slice.session.summary } : null
      const previousList = qc.getQueriesData<SessionListCache>({ queryKey: ["sessions"] })
      useSessionStore.getState().setSessionSummary(sessionId, newTitle)
      setSessionListSummary(qc, sessionId, newTitle)
      return { prior, previousList }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["sessions"] })
    },
    onError: (err, _vars, context) => {
      // Always restore prior summary on error — including null (untitled session).
      if (context?.prior) {
        useSessionStore.getState().setSessionSummary(sessionId, context.prior.summary)
      }
      if (context?.previousList) {
        for (const [key, data] of context.previousList) {
          qc.setQueryData(key, data)
        }
      }
      toast.error(`Rename failed: ${(err as Error).message}`)
    },
  })

  return { resume, abort, archive, unarchive, rename }
}
