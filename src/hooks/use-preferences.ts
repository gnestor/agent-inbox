import { useCallback } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { getPreferences, setPreference } from "@/api/client"

const PREFS_KEY = ["preferences"]

export function usePreference<T>(key: string, defaultValue: T): [T, (value: T) => void] {
  const qc = useQueryClient()

  const { data: prefs } = useQuery({
    queryKey: PREFS_KEY,
    queryFn: getPreferences,
    staleTime: Infinity,
  })

  const value = prefs && key in prefs ? (prefs[key] as T) : defaultValue

  const setValue = useCallback(
    (newValue: T) => {
      // Optimistic update — write into the query cache immediately
      qc.setQueryData<Record<string, unknown>>(PREFS_KEY, (old) => ({
        ...old,
        [key]: newValue,
      }))
      setPreference(key, newValue).catch(() => {})
    },
    [key, qc],
  )

  return [value, setValue]
}
