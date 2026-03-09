import { useState, useEffect, useCallback, useRef } from "react"
import { getPreferences, setPreference } from "@/api/client"

let cache: Record<string, unknown> | null = null
let loadPromise: Promise<Record<string, unknown>> | null = null
const listeners = new Map<string, Set<() => void>>()

function notifyListeners(key: string) {
  const set = listeners.get(key)
  if (set) for (const fn of set) fn()
}

function notifyAll() {
  for (const set of listeners.values()) {
    for (const fn of set) fn()
  }
}

function load(): Promise<Record<string, unknown>> {
  if (!loadPromise) {
    loadPromise = getPreferences()
      .then((prefs) => {
        cache = prefs
        notifyAll()
        return prefs
      })
      .catch(() => {
        cache = {}
        return cache
      })
  }
  return loadPromise
}

export function usePreference<T>(key: string, defaultValue: T): [T, (value: T) => void] {
  const [, rerender] = useState(0)
  const defaultRef = useRef(defaultValue)

  useEffect(() => {
    const listener = () => rerender((n) => n + 1)
    let set = listeners.get(key)
    if (!set) {
      set = new Set()
      listeners.set(key, set)
    }
    set.add(listener)
    load()
    return () => {
      set!.delete(listener)
      if (set!.size === 0) listeners.delete(key)
    }
  }, [key])

  const value = cache && key in cache ? (cache[key] as T) : defaultRef.current

  const setValue = useCallback(
    (newValue: T) => {
      if (!cache) cache = {}
      cache[key] = newValue
      notifyListeners(key)
      setPreference(key, newValue).catch(() => {})
    },
    [key],
  )

  return [value, setValue]
}
