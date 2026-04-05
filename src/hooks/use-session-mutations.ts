import { useMutation, useQueryClient } from "@tanstack/react-query"
import { resumeSession, abortSession, archiveSession, unarchiveSession, updateSession } from "@/api/client"
import { toast } from "sonner"
import type { Session, SessionMessage, SessionStatus } from "@/types"

interface SessionDetailCache { session: Session; messages: SessionMessage[] }
interface SessionListCache { sessions: Session[] }

interface UseSessionMutationsOptions {
  sessionId: string
  onResume?: () => void
  onArchive?: () => void
}

type QC = ReturnType<typeof useQueryClient>

function setSessionStatus(qc: QC, sessionId: string, status: SessionStatus) {
  qc.setQueryData<SessionDetailCache | undefined>(["session", sessionId], (old: SessionDetailCache | undefined) => {
    if (!old) return old
    return { ...old, session: { ...old.session, status } }
  })
}

function setSessionListStatus(qc: QC, sessionId: string, status: SessionStatus) {
  qc.setQueriesData<SessionListCache>({ queryKey: ["sessions"] }, (old) => {
    if (!old?.sessions) return old
    return { ...old, sessions: old.sessions.map((s) => (s.id === sessionId ? { ...s, status } : s)) }
  })
}

/** Shared optimistic update pattern: cancel in-flight → set status → invalidate on settle → rollback on error */
function optimisticStatusSwitch(qc: QC, sessionId: string, target: SessionStatus, rollback: SessionStatus) {
  return {
    onMutate: async () => {
      await Promise.all([
        qc.cancelQueries({ queryKey: ["sessions"] }),
        qc.cancelQueries({ queryKey: ["session", sessionId] }),
      ])
      setSessionStatus(qc, sessionId, target)
      setSessionListStatus(qc, sessionId, target)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["sessions"] })
      qc.invalidateQueries({ queryKey: ["session", sessionId] })
    },
    onError: (err: Error) => {
      setSessionStatus(qc, sessionId, rollback)
      setSessionListStatus(qc, sessionId, rollback)
      console.error(`Failed to update session status:`, err)
    },
  }
}

export function useSessionMutations({ sessionId, onResume, onArchive }: UseSessionMutationsOptions) {
  const qc = useQueryClient()

  const resume = useMutation({
    mutationFn: (prompt: string) => resumeSession(sessionId, prompt),
    onMutate: () => {
      setSessionStatus(qc, sessionId, "running")
      setSessionListStatus(qc, sessionId, "running")
    },
    onSuccess: () => {
      onResume?.()
      qc.invalidateQueries({ queryKey: ["sessions"] })
    },
    onError: (err: Error) => {
      console.error("Failed to resume session:", err)
      setSessionStatus(qc, sessionId, "complete")
      setSessionListStatus(qc, sessionId, "complete")
      toast.error(`Failed to resume session: ${err.message}`)
    },
    // No onSettled refetch — SSE owns the message cache during streaming.
    // A REST refetch here races with JSONL writes and clobbers SSE-pushed messages.
  })

  const abort = useMutation({
    mutationFn: () => abortSession(sessionId),
    onMutate: () => {
      setSessionStatus(qc, sessionId, "complete")
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sessions"] })
      // No detail refetch — SSE session_complete/session_error handles status.
      // Refetching here races with final JSONL writes.
    },
    onError: (err: Error) => console.error("Failed to abort session:", err),
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
      await Promise.all([
        qc.cancelQueries({ queryKey: ["sessions"] }),
        qc.cancelQueries({ queryKey: ["session", sessionId] }),
      ])
      const previousDetail = qc.getQueryData<SessionDetailCache>(["session", sessionId])
      const previousList = qc.getQueriesData<SessionListCache>({ queryKey: ["sessions"] })
      qc.setQueryData<SessionDetailCache | undefined>(["session", sessionId], (old: SessionDetailCache | undefined) => {
        if (!old) return old
        return { ...old, session: { ...old.session, summary: newTitle } }
      })
      qc.setQueriesData<SessionListCache>({ queryKey: ["sessions"] }, (old) => {
        if (!old?.sessions) return old
        return { ...old, sessions: old.sessions.map((s) => (s.id === sessionId ? { ...s, summary: newTitle } : s)) }
      })
      return { previousDetail, previousList }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["session", sessionId] })
      qc.invalidateQueries({ queryKey: ["sessions"] })
    },
    onError: (err, _vars, context) => {
      if (context?.previousDetail) {
        qc.setQueryData(["session", sessionId], context.previousDetail)
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
