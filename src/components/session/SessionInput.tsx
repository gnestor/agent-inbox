import { Button, Textarea } from "@hammies/frontend/components/ui"
import { Send, Square, Loader2 } from "lucide-react"
import { useLocalDraft } from "@/hooks/use-local-draft"
import { uploadPendingFiles } from "@/hooks/use-session-view"
import { FileAttachmentBar, AttachButton, DragOverlay, HiddenFileInput } from "./FileAttachmentBar"
import type { useFileAttachments } from "@/hooks/use-file-attachments"

type FileAttachments = ReturnType<typeof useFileAttachments>

interface SessionInputProps {
  sessionId: string
  isStreaming: boolean
  isSending: boolean
  onSend: (prompt: string) => void
  onAbort: () => void
  isAbortPending: boolean
  attachments?: FileAttachments
}

export function SessionInput({ sessionId, isStreaming, isSending, onSend, onAbort, isAbortPending, attachments }: SessionInputProps) {
  const resumeKey = `inbox:resume:${sessionId}`
  const [prompt, setPrompt] = useLocalDraft(resumeKey)
  const hasText = !!prompt.trim()
  const canSend = hasText || (attachments?.hasFiles ?? false)

  async function handleSend() {
    if (!canSend || isSending) return

    let fullPrompt = prompt.trim()

    if (attachments?.hasFiles) {
      const uploaded = await uploadPendingFiles(sessionId, attachments.files)
      if (uploaded.length > 0) {
        const refs = uploaded.map((f) => `[Attached: ${f.name} at ${f.path}]`).join("\n")
        fullPrompt = fullPrompt ? `${fullPrompt}\n\n${refs}` : refs
      }
      attachments.clearAll()
    }

    setPrompt("")
    onSend(fullPrompt)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div
      className="relative border-t px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      {...attachments?.dragHandlers}
    >
      {attachments && <DragOverlay visible={attachments.isDragOver} />}

      {/* Attachment bar (chips + errors) */}
      {attachments && (attachments.hasFiles || attachments.error) && (
        <div className="mb-2">
          <FileAttachmentBar
            files={attachments.files}
            error={attachments.error}
            onRemove={attachments.removeFile}
            onClearError={attachments.clearError}
            fileInputRef={attachments.fileInputRef}
            onFileInputChange={attachments.handleFileInputChange}
          />
        </div>
      )}

      <div className="flex gap-2 items-center">
        {attachments && <AttachButton onClick={attachments.openFilePicker} />}
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={attachments?.handlePaste}
          placeholder={isStreaming ? "Interrupt with a message..." : "Write a prompt..."}
          disabled={isSending}
          className="min-h-10 max-h-[120px] resize-none overflow-x-hidden [field-sizing:content]"
          rows={1}
        />
        {isStreaming && !hasText ? (
          <Button onClick={onAbort} disabled={isAbortPending} variant="ghost" size="icon-lg" className="text-[var(--ground)]">
            <Square className="h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={handleSend} disabled={!canSend || isSending} variant="ghost" size="icon-lg" className="text-[var(--ground)]">
            {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        )}
      </div>

      {attachments && (
        <HiddenFileInput fileInputRef={attachments.fileInputRef} onFileInputChange={attachments.handleFileInputChange} />
      )}
    </div>
  )
}
