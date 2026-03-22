import { useState, useEffect, useRef, useCallback } from "react"

/**
 * Manages a draft string persisted in localStorage.
 * Returns [draft, setDraft] — setDraft updates both React state and localStorage.
 * Cleans up the key when the draft is empty.
 */
export function useLocalDraft(key: string): [string, (value: string) => void] {
  const [draft, setDraftState] = useState(() => {
    try {
      return localStorage.getItem(key) ?? ""
    } catch {
      return ""
    }
  })

  // Track the current key so we can detect key changes
  const keyRef = useRef(key)

  // When the key changes, load the new draft
  useEffect(() => {
    if (keyRef.current === key) return
    keyRef.current = key
    try {
      setDraftState(localStorage.getItem(key) ?? "")
    } catch {
      setDraftState("")
    }
  }, [key])

  // Persist to localStorage whenever draft changes (skip on key change)
  const prevKeyRef = useRef(key)
  useEffect(() => {
    if (prevKeyRef.current !== key) {
      prevKeyRef.current = key
      return
    }
    try {
      if (draft.trim()) localStorage.setItem(key, draft)
      else localStorage.removeItem(key)
    } catch {}
  }, [draft, key])

  const setDraft = useCallback((value: string) => {
    setDraftState(value)
  }, [])

  return [draft, setDraft]
}
