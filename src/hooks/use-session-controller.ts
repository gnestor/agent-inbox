import { useCallback, useEffect, useMemo, useRef } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { answerSessionQuestion, getUserProfiles } from "@/api/client"
import { useSessionTranscript } from "./use-session-transcript"
import { useSessionStore } from "@/stores/session-store"
import { useSessionMutations } from "./use-session-mutations"
import { processTranscript, filterVisible } from "@/lib/session-pipeline"
import type { Session, PendingQuestion, SessionMessage, PresenceUser } from "@/types"
import type { MessageLookups, ClassifiedMessage, TranscriptVisibility } from "@/lib/session-pipeline"
import type { SessionSlice } from "@/stores/session-store"
import type { PendingPrompt } from "@/stores/session-reducer"

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
  | { status: "errored" }
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
// Hook
// ---------------------------------------------------------------------------

const EMPTY_MESSAGE_IDS: readonly number[] = Object.freeze([])
const EMPTY_MESSAGE_BY_ID: Readonly<Record<number, SessionMessage>> = Object.freeze({})
const EMPTY_PENDING: readonly PendingPrompt[] = Object.freeze([])

export function useSessionController({
  sessionId,
  visibility,
  isActive = true,
  onResume,
  onArchive,
}: UseSessionControllerOptions): SessionController {
  const qc = useQueryClient()

  // --- Session transcript (store + WS + REST) ---
  const slice: SessionSlice | undefined = useSessionTranscript(isActive ? sessionId : undefined)

  // --- Mutations (still owns ["sessions"] list optimistic updates) ---
  const mutations = useSessionMutations({ sessionId, onResume, onArchive })

  // --- Invalidate sessions list on terminal status changes ---
  const prevStatusRef = useRef<string | null>(null)
  useEffect(() => {
    const status = slice?.session.status
    if (!status) return
    if (prevStatusRef.current === status) return
    prevStatusRef.current = status
    if (status === "complete" || status === "errored" || status === "archived") {
      qc.invalidateQueries({ queryKey: ["sessions"] })
    }
  }, [slice?.session.status, qc])

  // --- Phase derivation ---
  // Single source of truth: slice.session.status + slice.pendingQuestion +
  // slice.recovery.bootstrapped. No circular writes.
  const phase: SessionPhase = useMemo(() => {
    if (!slice || !slice.recovery.bootstrapped) {
      // No snapshot yet. If we have a slice at all but bootstrap is pending,
      // this is the initial loading state.
      return { status: "loading" }
    }
    if (mutations.resume.isPending) return { status: "sending" }
    if (slice.pendingQuestion) return { status: "awaiting_input", question: slice.pendingQuestion }
    const status = slice.session.status
    if (status === "running") return { status: "streaming" }
    if (status === "errored") return { status: "errored" }
    if (status === "archived") return { status: "archived" }
    return { status: "idle" }
  }, [slice, mutations.resume.isPending])

  // --- Build the message array (real messages + optimistic pending prompts) ---
  const messageIds = slice?.messageIds ?? EMPTY_MESSAGE_IDS
  const messageById = slice?.messageById ?? EMPTY_MESSAGE_BY_ID
  const pendingPrompts = slice?.pendingPrompts ?? EMPTY_PENDING

  const combinedMessages = useMemo<SessionMessage[]>(() => {
    const real = messageIds.map((id) => messageById[id]!).filter(Boolean)
    if (pendingPrompts.length === 0) return real
    // Optimistic prompts render at the tail. We pick sequence numbers from
    // the top of the safe-integer range so they can never collide with
    // real server-assigned sequences, no matter how long the session runs.
    // The virtualizer keys by sequence, so uniqueness is what matters.
    const optimistic: SessionMessage[] = pendingPrompts.map((p, i) => {
      const seq = Number.MAX_SAFE_INTEGER - (pendingPrompts.length - 1 - i)
      return {
        id: seq,
        sessionId,
        sequence: seq,
        type: "user",
        message: { type: "user", content: p.prompt } as any,
        createdAt: p.createdAt,
      }
    })
    return [...real, ...optimistic]
  }, [messageIds, messageById, pendingPrompts, sessionId])

  // --- Pipeline: classify + build lookups ---
  const processed = useMemo(
    () => processTranscript(combinedMessages),
    [combinedMessages],
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
      next.authorEmails.length === prev.authorEmails.length &&
      next.fileMap.size === prev.fileMap.size
    ) {
      return prev
    }
    prevLookupsRef.current = next
    return next
  }, [processed.lookups])

  const messages = useMemo(
    () => filterVisible(processed.classified, visibility),
    [processed.classified, visibility],
  )

  // --- User profiles ---
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

  // --- Actions ---
  const resumeSession = useCallback((prompt: string) => {
    // Optimistically append the prompt to the store so the UI shows it
    // immediately. Status flips to "running". The reducer reconciles with
    // the server's echo when it arrives (same text = pending prompt dropped).
    useSessionStore.getState().submitOptimisticPrompt(sessionId, prompt)
    mutations.resume.mutate(prompt)
  }, [sessionId, mutations.resume])

  const answerQuestion = useCallback(async (answers: Record<string, string>) => {
    // Optimistically clear so a double-click can't re-submit. Restore on error.
    const store = useSessionStore.getState()
    const prior = store.sessions[sessionId]?.pendingQuestion ?? null
    if (!prior) return // no question to answer; defensive no-op
    store.clearPendingQuestion(sessionId)
    try {
      await answerSessionQuestion(sessionId, answers)
      qc.invalidateQueries({ queryKey: ["sessions"] })
    } catch (err) {
      useSessionStore.getState().setPendingQuestion(sessionId, prior)
      throw err
    }
  }, [sessionId, qc])

  // --- Event count (simple render counter from store slice for WorkingIndicator) ---
  const eventCount = messageIds.length

  return {
    phase,
    session: slice?.session,
    messages,
    lookups,
    userProfiles,
    presenceUsers: slice?.presence ?? [],
    eventCount,
    isLive: slice?.recovery.bootstrapped ?? false,
    resumeSession,
    answerQuestion,
    mutations,
  }
}
