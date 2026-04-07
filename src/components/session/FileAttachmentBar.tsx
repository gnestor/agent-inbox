import { X, Paperclip, FileIcon, AlertCircle } from "lucide-react"
import type { PendingFile } from "@/hooks/use-file-attachments"

function FileChip({ file, onRemove }: { file: PendingFile; onRemove: () => void }) {
  const isImage = file.previewUrl !== null

  return (
    <div className="group relative flex items-center gap-1.5 rounded-md border bg-secondary/50 px-2 py-1.5 text-xs max-w-[200px]">
      {isImage ? (
        <img
          src={file.previewUrl!}
          alt={file.name}
          className="h-8 w-8 rounded object-cover shrink-0"
        />
      ) : (
        <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
      )}
      <span className="truncate text-sm">{file.name}</span>
      <button
        type="button"
        onClick={onRemove}
        className="shrink-0 p-0.5 rounded-full hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
        title="Remove attachment"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Attachment bar — sits below the input, shows pending files and errors
// ---------------------------------------------------------------------------

interface FileAttachmentBarProps {
  files: PendingFile[]
  error: string | null
  onRemove: (id: string) => void
  onClearError: () => void
}

export function FileAttachmentBar({
  files,
  error,
  onRemove,
  onClearError,
}: FileAttachmentBarProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {error && (
        <div className="flex items-center gap-1.5 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={onClearError}
            className="shrink-0 p-0.5 rounded-full hover:bg-destructive/20"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {files.map((f) => (
            <FileChip key={f.id} file={f} onRemove={() => onRemove(f.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

/** Hidden file input — render once, unconditionally, wherever file attachments are used */
export function HiddenFileInput({
  fileInputRef,
  onFileInputChange,
}: {
  fileInputRef: React.RefObject<HTMLInputElement | null>
  onFileInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <input
      ref={fileInputRef}
      type="file"
      multiple
      className="hidden"
      onChange={onFileInputChange}
    />
  )
}

export function AttachButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
      title="Attach file"
    >
      <Paperclip className="h-4 w-4" />
    </button>
  )
}

export function DragOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary/50 bg-primary/5 pointer-events-none">
      <div className="flex flex-col items-center gap-1 text-primary/70">
        <Paperclip className="h-6 w-6" />
        <span className="text-sm font-medium">Drop files to attach</span>
      </div>
    </div>
  )
}
