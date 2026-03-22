import { useEffect, useMemo, useRef } from "react"
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
  onResume?: () => void
  onArchive?: () => void
}

export function useSessionPhase({ sessionId, onResume, onArchive }: UseSessionPhaseOptions) {
  const qc = useQueryClient()

  const { data, isLoading, error: queryError } = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => getSession(sessionId),
    refetchOnMount: true,
  })

  const mutations = useSessionMutations({ sessionId, onResume, onArchive })

  // Derive whether to stream from query cache status
  const queryStatus = data?.session.status as string | undefined
  const shouldStream = queryStatus === "running" || queryStatus === "awaiting_user_input"

  const stream = useSessionStream(sessionId, shouldStream)

  // Invalidate sessions list when stream detects a status change
  // so sidebar and list view update immediately (not on next poll).
  const prevStreamStatus = useRef(stream.sessionStatus)
  useEffect(() => {
    if (stream.sessionStatus && stream.sessionStatus !== prevStreamStatus.current) {
      qc.invalidateQueries({ queryKey: ["sessions"] })
      qc.invalidateQueries({ queryKey: ["session", sessionId] })
    }
    prevStreamStatus.current = stream.sessionStatus
  }, [stream.sessionStatus, qc, sessionId])

  // Single derivation — priority order matters
  const effectiveStatus = stream.sessionStatus ?? queryStatus
  const phase: SessionPhase =
    isLoading ? { status: "loading" } :
    queryError ? { status: "error", message: queryError.message } :
    mutations.resume.isPending ? { status: "sending" } :
    stream.pendingQuestion ? { status: "awaiting_input", question: stream.pendingQuestion } :
    effectiveStatus === "running" ? { status: "streaming" } :
    effectiveStatus === "archived" ? { status: "archived" } :
    { status: "idle" }

  // Merge initial messages with streamed ones, normalizing REST-loaded messages.
  // Prepend session.prompt as a synthetic user message — the JSONL doesn't include it.
  const initialMessages = data?.messages ?? []
  const sessionPrompt = data?.session.prompt
  const allMessages = useMemo(() => {
    const merged = new Map<number, SessionMessage>()
    if (sessionPrompt) {
      merged.set(-1, {
        id: -1,
        sessionId,
        sequence: -1,
        type: "user",
        message: { type: "user", content: sessionPrompt },
        createdAt: data?.session.startedAt ?? "",
      } as SessionMessage)
    }
    for (const message of initialMessages) {
      merged.set(message.sequence, { ...message, message: normalizeMessagePayload(message.message) })
    }
    for (const message of stream.messages) merged.set(message.sequence, message)
    return [...merged.values()].sort((a, b) => a.sequence - b.sequence)
  }, [initialMessages, stream.messages, sessionPrompt, sessionId, data?.session.startedAt])

  async function answerQuestion(answers: Record<string, string>) {
    await answerSessionQuestion(sessionId, answers)
    stream.clearPendingQuestion()
    qc.invalidateQueries({ queryKey: ["sessions"] })
  }

  return {
    phase,
    session: data?.session,
    messages: allMessages,
    presenceUsers: stream.presenceUsers,
    isLive: stream.connected,
    mutations,
    answerQuestion,
  }
}
