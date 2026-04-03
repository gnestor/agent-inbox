import { useState, useCallback, useRef, useEffect } from "react"
import { get, set, del } from "idb-keyval"
import { useLocation } from "react-router-dom"
import { useNavActions } from "@/lib/navigation-store"
import type { OutputSpec } from "@/components/session/OutputRenderer"
import type { SessionPhase } from "@/hooks/use-session-controller"
import type { Session } from "@/types"

interface UseSessionViewOptions {
  sessionId: string
  panelId: string
  title?: string
  session: Session | undefined
  phase: SessionPhase
  mutations: {
    rename: { mutate: (title: string) => void }
  }
  resumeSession: (prompt: string) => void
}

export function useSessionView({ sessionId, panelId, title, session, phase, mutations, resumeSession }: UseSessionViewOptions) {
  const location = useLocation()
  const { removePanel, pushPanel } = useNavActions()
  const isFromSidebar = location.pathname.startsWith("/recent/")

  function handleBack() {
    removePanel(panelId)
  }

  // --- Draft input ---
  // Use a ref to avoid re-rendering the heavy SessionTranscript on every keystroke.
  // The RichTextEditor manages its own internal state via TipTap.
  // Persist to IndexedDB without triggering re-renders.
  const draftKey = `draft:resume:${sessionId}`
  const promptRef = useRef("")
  const [initialDraft, setInitialDraft] = useState("")
  useEffect(() => {
    get<string>(draftKey).then((val) => {
      if (val) {
        promptRef.current = val
        setInitialDraft(val)
      }
    }).catch(() => {})
  }, [draftKey])

  // --- Open panel (useCallback: passed to SessionTranscript which is not trivially re-rendered) ---

  const handleOpenPanel = useCallback((spec: OutputSpec, sequence: number) => {
    pushPanel({
      id: `output:${sessionId}:${sequence}`,
      type: "output",
      props: { sessionId, sequence, outputType: spec.type, spec },
    })
  }, [sessionId, pushPanel])

  // --- Title editing ---

  const [isEditing, setIsEditing] = useState(false)
  const [editTitle, setEditTitle] = useState("")

  const displayTitle = session?.linkedItemTitle || session?.summary || title || session?.prompt?.slice(0, 80) || "Untitled"

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

  // --- Input state ---

  const isStreaming = phase.status === "streaming" || phase.status === "sending"
  const isSending = phase.status === "sending"

  const draftTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const handlePromptChange = useCallback((md: string) => {
    promptRef.current = md
    clearTimeout(draftTimerRef.current)
    if (md.trim()) draftTimerRef.current = setTimeout(() => set(draftKey, md).catch(() => {}), 400)
    else del(draftKey).catch(() => {})
  }, [draftKey])

  const handleSend = useCallback(() => {
    const text = promptRef.current.trim()
    if (!text || isSending) return
    resumeSession(text)
    promptRef.current = ""
    del(draftKey).catch(() => {})
  }, [isSending, resumeSession, draftKey])

  return {
    // Title editing
    isEditing,
    editTitle,
    displayTitle,
    handleStartEdit,
    handleFinishEdit,
    handleEditKeyDown,
    setEditTitle,

    // Input
    promptRef,
    initialDraft,
    handlePromptChange,
    isStreaming,
    isSending,
    handleSend,

    // Navigation
    handleBack,
    handleOpenPanel,
    isFromSidebar,
  }
}
