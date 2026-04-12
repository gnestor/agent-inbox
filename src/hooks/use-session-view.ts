import { useState, useCallback } from "react"
import { useLocation } from "react-router-dom"
import { useNavActions } from "@/lib/navigation-store"
import { useFileAttachments } from "./use-file-attachments"
import { uploadSessionFile } from "@/api/client"
import type { OutputSpec } from "@/components/session/OutputRenderer"
import type { SessionPhase } from "@/hooks/use-session-controller"
import type { Session } from "@/types"
import type { PendingFile, UploadedFile } from "./use-file-attachments"

interface UseSessionViewOptions {
  sessionId: string
  panelId: string
  title?: string
  session: Session | undefined
  phase: SessionPhase
  mutations: {
    rename: { mutate: (title: string) => void }
  }
}

export function useSessionView({ sessionId, panelId, title, session, phase, mutations }: UseSessionViewOptions) {
  const location = useLocation()
  const { removePanel, pushPanel } = useNavActions()
  const isFromSidebar = location.pathname.startsWith("/recent/")

  function handleBack() {
    removePanel(panelId)
  }

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

  // --- Derived phase state ---

  const isStreaming = phase.status === "streaming" || phase.status === "sending"
  const isSending = phase.status === "sending"

  // --- File attachments ---

  const attachments = useFileAttachments()

  return {
    // Title editing
    isEditing,
    editTitle,
    displayTitle,
    handleStartEdit,
    handleFinishEdit,
    handleEditKeyDown,
    setEditTitle,

    // Phase
    isStreaming,
    isSending,

    // File attachments
    attachments,

    // Navigation
    handleBack,
    handleOpenPanel,
    isFromSidebar,
  }
}

/** Upload pending files in parallel. Failures are logged and skipped. */
export async function uploadPendingFiles(
  sessionId: string,
  files: PendingFile[],
): Promise<UploadedFile[]> {
  const settled = await Promise.allSettled(
    files.map(async (pending) => {
      const uploaded = await uploadSessionFile(sessionId, pending.file)
      return {
        id: pending.id,
        name: uploaded.name,
        path: uploaded.path,
        size: uploaded.size,
        mimeType: uploaded.mimeType,
      } satisfies UploadedFile
    }),
  )

  const results: UploadedFile[] = []
  settled.forEach((result, i) => {
    if (result.status === "fulfilled") {
      results.push(result.value)
    } else {
      console.error(`Failed to upload ${files[i]?.name}:`, result.reason)
    }
  })
  return results
}
