import { useMutation, useQueryClient } from "@tanstack/react-query"
import { updateSession, attachToSession } from "@/api/client"

export function useRenameSession(sessionId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (summary: string) => updateSession(sessionId, { summary }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["session", sessionId] })
      qc.invalidateQueries({ queryKey: ["sessions"] })
    },
  })
}

export function useAttachToSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      sessionId,
      source,
    }: {
      sessionId: string
      source: { type: string; id: string; title: string; content: string }
    }) => attachToSession(sessionId, source),
    onSuccess: (_, { sessionId }) => {
      qc.invalidateQueries({ queryKey: ["session", sessionId] })
      qc.invalidateQueries({ queryKey: ["sessions"] })
    },
  })
}
