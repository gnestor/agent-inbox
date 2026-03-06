import { useState, useEffect, useCallback, useRef } from "react"
import { getPreferences, setPreference } from "@/api/client"

let cache: Record<string, unknown> | null = null
let loadPromise: Promise<Record<string, unknown>> | null = null
const listeners = new Set<() => void>()

function notifyListeners() {
  for (const fn of listeners) fn()
}

function load(): Promise<Record<string, unknown>> {
  if (!loadPromise) {
    loadPromise = getPreferences()
      .then((prefs) => {
        cache = prefs
        notifyListeners()
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
    listeners.add(listener)
    load()
    return () => { listeners.delete(listener) }
  }, [])

  const value = cache && key in cache ? (cache[key] as T) : defaultRef.current

  const setValue = useCallback(
    (newValue: T) => {
      if (!cache) cache = {}
      cache[key] = newValue
      notifyListeners()
      setPreference(key, newValue).catch(() => {})
    },
    [key],
  )

  return [value, setValue]
}
