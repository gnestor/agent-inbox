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

  const queryStatus = data?.session.status as string | undefined
  // Always connect SSE when viewing a session (for presence).
  // Message streaming is a bonus when the session is running.
  const stream = useSessionStream(sessionId, !isLoading && !queryError)

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

  // Tracks stream.messages.length at the time resume was called.
  // The optimistic prompt shows until new stream messages arrive.
  const streamCountAtResumeRef = useRef<number | null>(null)

  // Merge initial messages with streamed ones, normalizing REST-loaded messages.
  // Prepend session.prompt as a synthetic user message — the JSONL doesn't include it.
  const initialMessages = data?.messages ?? []
  const sessionPrompt = data?.session.prompt
  const resumePrompt = mutations.resume.variables as string | undefined
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

    // Derived optimistic prompt: show resume prompt until new stream messages arrive
    const showOptimistic = resumePrompt
      && streamCountAtResumeRef.current !== null
      && stream.messages.length <= streamCountAtResumeRef.current
    if (showOptimistic) {
      const seq = Math.max(...merged.keys(), 0) + 1
      merged.set(seq, {
        id: seq,
        sessionId,
        sequence: seq,
        type: "user",
        message: { type: "user", content: resumePrompt },
        createdAt: new Date().toISOString(),
      } as SessionMessage)
    }

    return [...merged.values()].sort((a, b) => a.sequence - b.sequence)
  }, [initialMessages, stream.messages, sessionPrompt, sessionId, data?.session.startedAt, resumePrompt])

  function resumeSession(prompt: string) {
    streamCountAtResumeRef.current = stream.messages.length
    mutations.resume.mutate(prompt)
  }

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
    resumeSession,
    answerQuestion,
  }
}
