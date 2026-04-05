import { useState, useCallback, useRef, useEffect } from "react"
import { get, set, del } from "idb-keyval"

const PREFIX = "draft:"

/**
 * Manages a draft string persisted in IndexedDB.
 * Returns [draft, setDraft]. Resets when the key changes.
 * Empty drafts are deleted from storage.
 */
export function useLocalDraft(key: string): [string, (value: string) => void] {
  const [draft, setDraftState] = useState("")
  const keyRef = useRef(key)

  // Load draft from IndexedDB on mount and key change
  useEffect(() => {
    keyRef.current = key
    get<string>(PREFIX + key).then((val) => {
      if (keyRef.current === key) setDraftState(val ?? "")
    }).catch((err) => console.warn("[draft] Failed to load draft:", err))
  }, [key])

  // Persist to IndexedDB on change
  const setDraft = useCallback((value: string) => {
    setDraftState(value)
    const k = PREFIX + keyRef.current
    if (value.trim()) set(k, value).catch((err) => console.warn("[draft] Failed to save draft:", err))
    else del(k).catch((err) => console.warn("[draft] Failed to delete draft:", err))
  }, [])

  return [draft, setDraft]
}
