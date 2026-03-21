import { useMutation, useQueryClient } from "@tanstack/react-query"
import { resumeSession, abortSession, archiveSession, updateSession } from "@/api/client"
import type { SessionStatus } from "@/types"

interface UseSessionMutationsOptions {
  sessionId: string
  onResume?: () => void
  onArchive?: () => void
}

function setSessionStatus(qc: ReturnType<typeof useQueryClient>, sessionId: string, status: SessionStatus) {
  qc.setQueryData<any>(["session", sessionId], (old: any) => {
    if (!old) return old
    return { ...old, session: { ...old.session, status } }
  })
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

  const archive = useMutation({
    mutationFn: () => archiveSession(sessionId),
    onSuccess: () => {
      qc.setQueriesData<any[]>({ queryKey: ["sessions"] }, (old) => {
        if (!Array.isArray(old)) return old
        return old.map((s) => (s.id === sessionId ? { ...s, status: "archived" } : s))
      })
      onArchive?.()
      qc.invalidateQueries({ queryKey: ["sessions"] })
      qc.invalidateQueries({ queryKey: ["session", sessionId] })
    },
    onError: (err: any) => console.error("Failed to archive session:", err),
  })

  const rename = useMutation({
    mutationFn: (newTitle: string) => updateSession(sessionId, { summary: newTitle }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["session", sessionId] })
      qc.invalidateQueries({ queryKey: ["sessions"] })
    },
  })

  return { resume, abort, archive, rename }
}
