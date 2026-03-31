import { useCallback, useEffect, useMemo, useRef } from "react"
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
  /** Whether this session's tab is currently active (visible) */
  isActive?: boolean
  onResume?: () => void
  onArchive?: () => void
}

export function useSessionPhase({ sessionId, isActive = true, onResume, onArchive }: UseSessionPhaseOptions) {
  const qc = useQueryClient()
  const autoResumedRef = useRef(false)
  // Reset auto-resume guard when switching sessions
  useEffect(() => { autoResumedRef.current = false }, [sessionId])

  const { data, isPending, error: queryError } = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => getSession(sessionId),
  })

  const mutations = useSessionMutations({ sessionId, onResume, onArchive })

  const queryStatus = data?.session.status as string | undefined
  const isRunning = queryStatus === "running" || queryStatus === "awaiting_user_input"
  // Connect SSE when actively viewing (for presence) or when session is running.
  // Disconnect for background tabs to avoid exhausting browser connection limit.
  const stream = useSessionStream(sessionId, !isPending && !queryError && (isActive || isRunning))

  // Auto-resume orphaned sessions: DB says "running" but server has no active agent process.
  // This happens when the server restarts while a session is in progress.
  const resumeMutate = mutations.resume.mutate
  const resumeIsPending = mutations.resume.isPending
  useEffect(() => {
    if (!data?.session || autoResumedRef.current || resumeIsPending) return
    const { status, hasActiveProcess } = data.session
    const isOrphaned = (status === "running" || status === "awaiting_user_input") && hasActiveProcess === false
    if (isOrphaned) {
      // Only auto-resume running sessions. Orphaned awaiting_user_input sessions
      // are handled by the SSE handler re-delivering the original question.
      if (status === "running") {
        autoResumedRef.current = true
        console.log(`[session:${sessionId}] Orphaned running session — auto-resuming`)
        resumeMutate("The server was restarted. Continue where you left off.")
      }
    }
  }, [data?.session, sessionId, resumeIsPending, resumeMutate])

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

  // Single derivation — priority order matters.
  // "archived" is a user-initiated terminal state that stream events must not override.
  const effectiveStatus = queryStatus === "archived" ? "archived" : (stream.sessionStatus ?? queryStatus)
  const phase: SessionPhase =
    isPending ? { status: "loading" } :
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
  // Only prepend the session prompt as a synthetic user message when the transcript
  // has no messages (e.g. DB-only session before JSONL exists). The JSONL already
  // includes the first user message, so adding a synthetic one would duplicate it.
  // Guard against stale data from a previous session during query key transitions.
  // React Query can briefly return the old key's cached data before the new key resolves.
  const dataMatchesSession = data?.session.id === sessionId
  const initialMessages = dataMatchesSession ? (data?.messages ?? []) : []
  const sessionPrompt = dataMatchesSession ? data?.session.prompt : undefined
  const resumePrompt = mutations.resume.variables as string | undefined
  const allMessages = useMemo(() => {
    const merged = new Map<number, SessionMessage>()
    // Always include the initial prompt as the first message.
    // Check if it already exists in the transcript to avoid duplicates.
    if (sessionPrompt) {
      const promptExists = initialMessages.some(m => {
        if (m.type !== "user") return false
        const msg = m.message as any
        const content = msg?.content ?? msg?.message?.content
        if (content === sessionPrompt) return true
        if (Array.isArray(content) && content[0]?.text === sessionPrompt) return true
        return false
      })
      if (!promptExists) {
        merged.set(-1, {
          id: -1,
          sessionId,
          sequence: -1,
          type: "user",
          message: { type: "user", content: sessionPrompt },
          createdAt: data?.session.startedAt ?? "",
        } as SessionMessage)
      }
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

  const answerQuestion = useCallback(async (answers: Record<string, string>) => {
    await answerSessionQuestion(sessionId, answers)
    stream.clearPendingQuestion()
    qc.invalidateQueries({ queryKey: ["sessions"] })
  }, [sessionId, stream, qc])

  return {
    phase,
    session: data?.session,
    messages: allMessages,
    presenceUsers: stream.presenceUsers,
    eventCount: stream.eventCount,
    isLive: stream.connected,
    mutations,
    resumeSession,
    answerQuestion,
  }
}
