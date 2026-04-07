import { Button, Textarea } from "@hammies/frontend/components/ui"
import { Send, Square, Loader2 } from "lucide-react"
import { useLocalDraft } from "@/hooks/use-local-draft"

interface SessionInputProps {
  sessionId: string
  isStreaming: boolean
  isSending: boolean
  onSend: (prompt: string) => void
  onAbort: () => void
  isAbortPending: boolean
}

export function SessionInput({ sessionId, isStreaming, isSending, onSend, onAbort, isAbortPending }: SessionInputProps) {
  const resumeKey = `inbox:resume:${sessionId}`
  const [prompt, setPrompt] = useLocalDraft(resumeKey)
  const hasText = !!prompt.trim()

  function handleSend() {
    if (!hasText || isSending) return
    const text = prompt.trim()
    setPrompt("")
    onSend(text)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="border-t px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="flex gap-2 items-end">
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
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
          <Button onClick={handleSend} disabled={!hasText || isSending} variant="ghost" size="icon-lg" className="text-[var(--ground)]">
            {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        )}
      </div>
    </div>
  )
}
