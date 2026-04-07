import { useState, useCallback, useRef, useEffect } from "react"
import { get, set, del } from "idb-keyval"

const PREFIX = "draft:"
const DEBOUNCE_MS = 300

/**
 * Manages a draft string persisted in IndexedDB.
 * Returns [draft, setDraft]. Resets when the key changes.
 * Empty drafts are deleted from storage. IDB writes are debounced.
 */
export function useLocalDraft(key: string): [string, (value: string) => void] {
  const [draft, setDraftState] = useState("")
  const keyRef = useRef(key)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Load draft from IndexedDB on mount and key change
  useEffect(() => {
    keyRef.current = key
    get<string>(PREFIX + key).then((val) => {
      if (keyRef.current === key) setDraftState(val ?? "")
    }).catch((err) => console.warn("[draft] Failed to load draft:", err))
  }, [key])

  // Flush pending write on unmount (don't lose typed drafts)
  useEffect(() => {
    return () => {
      clearTimeout(timerRef.current)
      const pending = pendingRef.current
      if (pending !== null) {
        const k = PREFIX + keyRef.current
        if (pending.trim()) set(k, pending).catch(() => {})
        else del(k).catch(() => {})
      }
    }
  }, [])

  // Persist to IndexedDB on change (debounced)
  const pendingRef = useRef<string | null>(null)
  const setDraft = useCallback((value: string) => {
    setDraftState(value)
    pendingRef.current = value
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      pendingRef.current = null
      const k = PREFIX + keyRef.current
      if (value.trim()) set(k, value).catch((err) => console.warn("[draft] Failed to save draft:", err))
      else del(k).catch((err) => console.warn("[draft] Failed to delete draft:", err))
    }, DEBOUNCE_MS)
  }, [])

  return [draft, setDraft]
}
