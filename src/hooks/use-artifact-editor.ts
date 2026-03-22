import { useSyncExternalStore } from "react"

/**
 * Lightweight pub-sub store for sharing artifact code between
 * the artifact panel (consumer) and code editor panel (producer).
 *
 * Key format: "artifact:{sessionId}:{sequence}"
 */
const store = new Map<string, string>()
const listeners = new Map<string, Set<() => void>>()

function notify(key: string) {
  listeners.get(key)?.forEach((fn) => fn())
}

export function setEditingCode(key: string, code: string) {
  store.set(key, code)
  notify(key)
}

export function clearEditingCode(key: string) {
  store.delete(key)
  notify(key)
}

export function getEditingCode(key: string): string | undefined {
  return store.get(key)
}

/** Subscribe to live code changes for a given artifact key. */
export function useEditingCode(key: string): string | undefined {
  return useSyncExternalStore(
    (cb) => {
      let set = listeners.get(key)
      if (!set) {
        set = new Set()
        listeners.set(key, set)
      }
      set.add(cb)
      return () => {
        set!.delete(cb)
        if (set!.size === 0) listeners.delete(key)
      }
    },
    () => store.get(key),
  )
}

export function artifactEditorKey(sessionId: string, sequence: number): string {
  return `artifact:${sessionId}:${sequence}`
}
