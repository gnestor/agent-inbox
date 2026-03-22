import { useState, useRef, useCallback } from "react"
import { useLocation } from "react-router-dom"
import { useLocalDraft } from "./use-local-draft"
import { useNavigation } from "./use-navigation"
import { usePreference } from "./use-preferences"
import { DEFAULT_TRANSCRIPT_VISIBILITY } from "@/components/session/SessionTranscript"
import type { TranscriptVisibility } from "@/components/session/SessionTranscript"
import type { OutputSpec } from "@/components/session/OutputRenderer"
import type { SessionPhase } from "./use-session-phase"
import type { Session } from "@/types"

interface UseSessionViewOptions {
  sessionId: string
  title?: string
  session: Session | undefined
  phase: SessionPhase
  mutations: {
    rename: { mutate: (title: string) => void }
    resume: { mutate: (prompt: string) => void }
  }
}

export function useSessionView({ sessionId, title, session, phase, mutations }: UseSessionViewOptions) {
  const location = useLocation()
  const { activeTab, popPanel, deselectItem, pushPanel } = useNavigation()
  const isFromSidebar = location.pathname.startsWith("/recent/")
  const sessionPanelId = `session:${sessionId}`

  // --- Back navigation ---

  function handleBack() {
    if (activeTab === "sessions") {
      deselectItem()
    } else {
      popPanel(sessionPanelId)
    }
  }

  // --- Draft input ---

  const resumeKey = `inbox:resume:${sessionId}`
  const [prompt, setPrompt] = useLocalDraft(resumeKey)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // --- Open panel (useCallback: passed to SessionTranscript which is not trivially re-rendered) ---

  const handleOpenPanel = useCallback((spec: OutputSpec, sequence: number) => {
    pushPanel({
      id: `artifact:${sessionId}:${sequence}`,
      type: "artifact",
      props: { sessionId, sequence, outputType: spec.type, spec },
    })
  }, [sessionId, pushPanel])

  // --- Title editing ---

  const [isEditing, setIsEditing] = useState(false)
  const [editTitle, setEditTitle] = useState("")

  const displayTitle = session?.linkedItemTitle ?? session?.summary ?? title ?? session?.prompt?.slice(0, 80) ?? "Session"

  function handleStartEdit() {
    setEditTitle(session?.summary ?? session?.prompt?.slice(0, 80) ?? displayTitle)
    setIsEditing(true)
  }

  function handleFinishEdit() {
    setIsEditing(false)
    const trimmed = editTitle.trim()
    if (trimmed && trimmed !== displayTitle) {
      mutations.rename.mutate(trimmed)
    }
  }

  function handleEditKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault()
      handleFinishEdit()
    }
    if (e.key === "Escape") {
      setIsEditing(false)
    }
  }

  // --- Transcript visibility ---

  const [visibility, setVisibility] = usePreference<TranscriptVisibility>(
    "sessions.transcript.visibility",
    DEFAULT_TRANSCRIPT_VISIBILITY,
  )

  function toggleVisibility(key: keyof TranscriptVisibility) {
    setVisibility({ ...visibility, [key]: !visibility[key] })
  }

  // --- Input state ---

  const isStreaming = phase.status === "streaming"
  const isSending = phase.status === "sending"
  const inputDisabled = isStreaming || isSending

  function handleSend() {
    if (!prompt.trim() || inputDisabled) return
    mutations.resume.mutate(prompt)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return {
    // Title editing
    isEditing,
    editTitle,
    displayTitle,
    handleStartEdit,
    handleFinishEdit,
    handleEditKeyDown,
    setEditTitle,

    // Visibility
    visibility,
    toggleVisibility,

    // Input
    prompt,
    setPrompt,
    textareaRef,
    isStreaming,
    isSending,
    inputDisabled,
    handleSend,
    handleKeyDown,

    // Navigation
    handleBack,
    handleOpenPanel,
    isFromSidebar,
  }
}
