import { useCallback, useEffect, useRef } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { getSession, answerSessionQuestion } from "@/api/client"
import { useSessionStream } from "./use-session-stream"
import { useSessionMutations } from "./use-session-mutations"
import type { PendingQuestion, SessionMessage } from "@/types"
import { normalizeMessagePayload } from "@/types/session-message"

// --- Session phase discriminated union ---

export type SessionPhase =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "streaming" }
  | { status: "awaiting_input"; question: PendingQuestion }
  | { status: "sending" }
  | { status: "idle" }
  | { status: "archived" }

interface UseSessionPhaseOptions {
  sessionId: string
  isActive?: boolean
  onResume?: () => void
  onArchive?: () => void
}

export function useSessionPhase({ sessionId, isActive = true, onResume, onArchive }: UseSessionPhaseOptions) {
  const qc = useQueryClient()

  const { data, isPending, error: queryError } = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => getSession(sessionId),
  })

  const mutations = useSessionMutations({ sessionId, onResume, onArchive })

  const queryStatus = data?.session.status as string | undefined
  const isRunning = queryStatus === "running" || queryStatus === "awaiting_user_input"
  const stream = useSessionStream(sessionId, !isPending && !queryError && (isActive || isRunning))

  // Invalidate sessions list when stream detects a status change
  const prevStreamStatus = useRef(stream.sessionStatus)
  useEffect(() => {
    if (stream.sessionStatus && stream.sessionStatus !== prevStreamStatus.current) {
      qc.invalidateQueries({ queryKey: ["sessions"] })
    }
    prevStreamStatus.current = stream.sessionStatus
  }, [stream.sessionStatus, qc])

  // Phase derivation — priority order matters.
  // "archived" is user-initiated and must not be overridden by stream events.
  const effectiveStatus = queryStatus === "archived" ? "archived" : (stream.sessionStatus ?? queryStatus)
  const phase: SessionPhase =
    isPending ? { status: "loading" } :
    queryError ? { status: "error", message: queryError.message } :
    mutations.resume.isPending ? { status: "sending" } :
    stream.pendingQuestion ? { status: "awaiting_input", question: stream.pendingQuestion } :
    effectiveStatus === "running" && stream.connected ? { status: "streaming" } :
    effectiveStatus === "running" && !stream.connected ? { status: "loading" } :
    effectiveStatus === "archived" ? { status: "archived" } :
    { status: "idle" }

  // Messages come directly from React Query cache (SSE updates it in place).
  // Normalize REST-loaded messages; SSE-pushed messages are already normalized.
  const dataMatchesSession = data?.session.id === sessionId
  const messages: SessionMessage[] = dataMatchesSession
    ? (data?.messages ?? []).map((m: SessionMessage) => ({
        ...m,
        message: normalizeMessagePayload(m.message),
      }))
    : []

  // Resume: append optimistic user message to cache, then call API
  function resumeSession(prompt: string) {
    // Optimistic: add user message to cache immediately
    qc.setQueryData(["session", sessionId], (old: any) => {
      if (!old) return old
      const msgs = old.messages ?? []
      const seq = msgs.length > 0 ? Math.max(...msgs.map((m: any) => m.sequence)) + 1 : 0
      const optimistic: SessionMessage = {
        id: seq,
        sessionId,
        sequence: seq,
        type: "user",
        message: { type: "user", content: prompt },
        createdAt: new Date().toISOString(),
      } as SessionMessage
      return { ...old, messages: [...msgs, optimistic] }
    })
    mutations.resume.mutate(prompt)
  }

  const answerQuestion = useCallback(async (answers: Record<string, string>) => {
    await answerSessionQuestion(sessionId, answers)
    stream.clearPendingQuestion()
    qc.invalidateQueries({ queryKey: ["sessions"] })
  }, [sessionId, stream, qc])

  return {
    phase,
    session: data?.session,
    messages,
    presenceUsers: stream.presenceUsers,
    eventCount: stream.eventCount,
    isLive: stream.connected,
    mutations,
    resumeSession,
    answerQuestion,
  }
}
