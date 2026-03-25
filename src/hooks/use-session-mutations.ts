import { useMutation, useQueryClient } from "@tanstack/react-query"
import { resumeSession, abortSession, archiveSession, unarchiveSession, updateSession } from "@/api/client"
import type { SessionStatus } from "@/types"

interface UseSessionMutationsOptions {
  sessionId: string
  onResume?: () => void
  onArchive?: () => void
}

type QC = ReturnType<typeof useQueryClient>

function setSessionStatus(qc: QC, sessionId: string, status: SessionStatus) {
  qc.setQueryData<any>(["session", sessionId], (old: any) => {
    if (!old) return old
    return { ...old, session: { ...old.session, status } }
  })
}

function setSessionListStatus(qc: QC, sessionId: string, status: SessionStatus) {
  qc.setQueriesData<any[]>({ queryKey: ["sessions"] }, (old) => {
    if (!Array.isArray(old)) return old
    return old.map((s) => (s.id === sessionId ? { ...s, status } : s))
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
    onError: (err: any) => {
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
    },
    onSuccess: () => {
      onResume?.()
      qc.invalidateQueries({ queryKey: ["sessions"] })
    },
    onError: (err: any) => console.error("Failed to resume session:", err),
  })

  const abort = useMutation({
    mutationFn: () => abortSession(sessionId),
    onMutate: () => {
      setSessionStatus(qc, sessionId, "complete")
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sessions"] })
      qc.invalidateQueries({ queryKey: ["session", sessionId] })
    },
    onError: (err: any) => console.error("Failed to abort session:", err),
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["session", sessionId] })
      qc.invalidateQueries({ queryKey: ["sessions"] })
    },
  })

  return { resume, abort, archive, unarchive, rename }
}
