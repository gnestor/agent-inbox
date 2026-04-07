import { useReducer, useCallback, useMemo, useRef } from "react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PendingFile {
  id: string
  file: File
  name: string
  size: number
  mimeType: string
  /** Object URL for image preview — only set for supported image types */
  previewUrl: string | null
}

export interface UploadedFile {
  id: string
  name: string
  path: string
  size: number
  mimeType: string
}

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

type State = {
  files: PendingFile[]
  error: string | null
  isDragOver: boolean
}

type Action =
  | { type: "ADD_FILES"; files: PendingFile[]; error?: string }
  | { type: "REMOVE_FILE"; id: string }
  | { type: "CLEAR_ALL" }
  | { type: "SET_ERROR"; error: string }
  | { type: "CLEAR_ERROR" }
  | { type: "SET_DRAG_OVER"; isDragOver: boolean }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "ADD_FILES":
      return { ...state, files: [...state.files, ...action.files], error: action.error ?? null }
    case "REMOVE_FILE": {
      const file = state.files.find((f) => f.id === action.id)
      if (file?.previewUrl) URL.revokeObjectURL(file.previewUrl)
      return { ...state, files: state.files.filter((f) => f.id !== action.id) }
    }
    case "CLEAR_ALL": {
      for (const f of state.files) {
        if (f.previewUrl) URL.revokeObjectURL(f.previewUrl)
      }
      return { ...state, files: [], error: null }
    }
    case "SET_ERROR":
      return { ...state, error: action.error }
    case "CLEAR_ERROR":
      return { ...state, error: null }
    case "SET_DRAG_OVER":
      return { ...state, isDragOver: action.isDragOver }
    default:
      return state
  }
}

const initialState: State = { files: [], error: null, isDragOver: false }

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useFileAttachments() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const fileInputRef = useRef<HTMLInputElement>(null)

  /** Validate and add files, returning any that passed validation */
  const addFiles = useCallback((fileList: FileList | File[]) => {
    const toAdd: PendingFile[] = []
    const tooLarge: string[] = []

    for (const file of Array.from(fileList)) {
      if (file.size > MAX_FILE_SIZE) {
        tooLarge.push(file.name)
        continue
      }
      const isImage = IMAGE_TYPES.has(file.type)
      toAdd.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        name: file.name,
        size: file.size,
        mimeType: file.type || "application/octet-stream",
        previewUrl: isImage ? URL.createObjectURL(file) : null,
      })
    }

    const error = tooLarge.length > 0
      ? `File${tooLarge.length > 1 ? "s" : ""} too large (max 10MB): ${tooLarge.join(", ")}`
      : undefined

    if (toAdd.length > 0) {
      dispatch({ type: "ADD_FILES", files: toAdd, error })
    } else if (error) {
      dispatch({ type: "SET_ERROR", error })
    }
  }, [])

  const removeFile = useCallback((id: string) => {
    dispatch({ type: "REMOVE_FILE", id })
  }, [])

  const clearAll = useCallback(() => {
    dispatch({ type: "CLEAR_ALL" })
  }, [])

  const clearError = useCallback(() => {
    dispatch({ type: "CLEAR_ERROR" })
  }, [])

  // --- Drag and drop handlers ---

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dispatch({ type: "SET_DRAG_OVER", isDragOver: true })
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Only set drag over to false if leaving the container (not entering a child)
    if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) {
      dispatch({ type: "SET_DRAG_OVER", isDragOver: false })
    }
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dispatch({ type: "SET_DRAG_OVER", isDragOver: false })
      if (e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files)
      }
    },
    [addFiles],
  )

  // --- Paste handler ---

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return

      const files: File[] = []
      for (const item of Array.from(items)) {
        if (item.kind === "file") {
          const file = item.getAsFile()
          if (file) files.push(file)
        }
      }

      if (files.length > 0) {
        e.preventDefault()
        addFiles(files)
      }
    },
    [addFiles],
  )

  // --- File input (click to browse) ---

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        addFiles(e.target.files)
      }
      // Reset so the same file can be re-selected
      e.target.value = ""
    },
    [addFiles],
  )

  const dragHandlers = useMemo(
    () => ({
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
    }),
    [handleDragOver, handleDragLeave, handleDrop],
  )

  return {
    files: state.files,
    error: state.error,
    isDragOver: state.isDragOver,
    hasFiles: state.files.length > 0,
    addFiles,
    removeFile,
    clearAll,
    clearError,
    openFilePicker,
    fileInputRef,
    handleFileInputChange,
    dragHandlers,
    handlePaste,
  }
}
