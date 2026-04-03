import { useCallback, useEffect, useMemo, useRef } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { getSession, answerSessionQuestion, getUserProfiles } from "@/api/client"
import { useSessionStream } from "./use-session-stream"
import { useSessionMutations } from "./use-session-mutations"
import { normalizeMessagePayload } from "@/types/session-message"
import { processTranscript, filterVisible } from "@/lib/session-pipeline"
import type { Session, PendingQuestion, SessionMessage, PresenceUser } from "@/types"
import type { MessageLookups, ClassifiedMessage, TranscriptVisibility } from "@/lib/session-pipeline"

type SessionQueryData = { session: Session; messages: SessionMessage[] }

// ---------------------------------------------------------------------------
// Phase discriminated union
// ---------------------------------------------------------------------------

export type SessionPhase =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "streaming" }
  | { status: "awaiting_input"; question: PendingQuestion }
  | { status: "sending" }
  | { status: "idle" }
  | { status: "archived" }

// ---------------------------------------------------------------------------
// Controller interface
// ---------------------------------------------------------------------------

export interface SessionController {
  phase: SessionPhase
  session: Session | undefined

  /** Classified messages filtered by visibility, ready to render */
  messages: ClassifiedMessage[]
  /** Derived lookups (tool results, resolved IDs, author emails) — stable reference */
  lookups: MessageLookups
  /** User profiles keyed by email */
  userProfiles: Map<string, { name: string; picture?: string }>

  presenceUsers: PresenceUser[]
  eventCount: number
  isLive: boolean

  resumeSession: (prompt: string) => void
  answerQuestion: (answers: Record<string, string>) => Promise<void>
  mutations: ReturnType<typeof useSessionMutations>
}

// ---------------------------------------------------------------------------
// Hook options
// ---------------------------------------------------------------------------

interface UseSessionControllerOptions {
  sessionId: string
  visibility: TranscriptVisibility
  isActive?: boolean
  onResume?: () => void
  onArchive?: () => void
}

// ---------------------------------------------------------------------------
// Hook implementation
// ---------------------------------------------------------------------------

export function useSessionController({
  sessionId,
  visibility,
  isActive = true,
  onResume,
  onArchive,
}: UseSessionControllerOptions): SessionController {
  const qc = useQueryClient()

  // --- Data fetching ---
  const { data, isPending, error: queryError } = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => getSession(sessionId),
  })

  // --- Mutations ---
  const mutations = useSessionMutations({ sessionId, onResume, onArchive })

  // --- Streaming ---
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

  // --- Phase derivation ---
  // Use queryStatus as the source of truth for lifecycle transitions (resume sets
  // it to "running", session_complete sets it to "complete"). stream.sessionStatus
  // is only used to detect completion/error when SSE reports it before the query
  // cache updates.
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

  // --- Message normalization (REST messages may need patching) ---
  const dataMatchesSession = data?.session.id === sessionId
  const rawMessages = dataMatchesSession ? (data?.messages ?? []) : []
  const normalizedMessages = useMemo(
    () => rawMessages.map((m: SessionMessage) => ({
      ...m,
      message: normalizeMessagePayload(m.message),
    })),
    [rawMessages],
  )

  // --- Pipeline: classify + build lookups (re-runs when messages change) ---
  const processed = useMemo(
    () => processTranscript(normalizedMessages),
    [normalizedMessages],
  )

  // Stabilize lookups reference — tool results and resolved IDs are append-only,
  // so size comparison is sufficient to detect changes.
  const prevLookupsRef = useRef(processed.lookups)
  const lookups = useMemo(() => {
    const next = processed.lookups
    const prev = prevLookupsRef.current
    if (
      next.toolResults.size === prev.toolResults.size &&
      next.resolvedToolUseIDs.size === prev.resolvedToolUseIDs.size &&
      next.authorEmails.length === prev.authorEmails.length
    ) {
      return prev
    }
    prevLookupsRef.current = next
    return next
  }, [processed.lookups])

  // --- Filter by visibility (separate memo so visibility changes don't recompute classification) ---
  const messages = useMemo(
    () => filterVisible(processed.classified, visibility),
    [processed.classified, visibility],
  )

  // --- User profiles (fetch from API based on emails extracted by pipeline) ---
  const emailsKey = lookups.authorEmails.join(",")
  const { data: profileData } = useQuery({
    queryKey: ["user-profiles", emailsKey],
    queryFn: () => getUserProfiles(lookups.authorEmails),
    enabled: lookups.authorEmails.length > 0,
  })
  const userProfiles = useMemo(() => {
    const map = new Map<string, { name: string; picture?: string }>()
    for (const u of profileData?.users ?? []) {
      map.set(u.email, { name: u.name, picture: u.picture })
    }
    return map
  }, [profileData])

  // --- Actions (stable callbacks) ---
  const resetForResume = stream.resetForResume
  const resumeSession = useCallback((prompt: string) => {
    // Allow STREAMING dispatches for the new run
    resetForResume()
    // Set status to "running" AND add optimistic message in the same cache update
    // so queryStatus is "running" before any SSE messages arrive.
    qc.setQueryData(["session", sessionId], (old: SessionQueryData | undefined) => {
      if (!old) return old
      const msgs = old.messages ?? []
      const seq = msgs.length > 0 ? -(msgs.length + 1) : -1
      const optimistic: SessionMessage = {
        id: seq,
        sessionId,
        sequence: seq,
        type: "user",
        message: { type: "user", content: prompt },
        createdAt: new Date().toISOString(),
      } as SessionMessage
      return {
        ...old,
        session: { ...old.session, status: "running" as const },
        messages: [...msgs, optimistic],
      }
    })
    mutations.resume.mutate(prompt)
  }, [sessionId, qc, mutations.resume, resetForResume])

  const clearPendingQuestion = stream.clearPendingQuestion
  const answerQuestion = useCallback(async (answers: Record<string, string>) => {
    await answerSessionQuestion(sessionId, answers)
    clearPendingQuestion()
    qc.invalidateQueries({ queryKey: ["sessions"] })
  }, [sessionId, clearPendingQuestion, qc])

  return {
    phase,
    session: data?.session,
    messages,
    lookups,
    userProfiles,
    presenceUsers: stream.presenceUsers,
    eventCount: stream.eventCount,
    isLive: stream.connected,
    resumeSession,
    answerQuestion,
    mutations,
  }
}
