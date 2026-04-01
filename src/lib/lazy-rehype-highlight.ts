// Lazy-loads rehype-highlight and highlight.js (~9MB) on first import.
// Uses useSyncExternalStore so components re-render when the plugin loads,
// ensuring code blocks that rendered before the import get highlighted.

import { useSyncExternalStore } from "react"
import type { PluggableList } from "unified"

let _plugins: PluggableList = []
const _listeners = new Set<() => void>()

// Start loading immediately on first import
import("rehype-highlight").then(async (mod) => {
  const [hljsMod, jsonMod] = await Promise.all([
    import("highlight.js/lib/core"),
    import("highlight.js/lib/languages/json"),
  ])
  hljsMod.default.registerLanguage("json", jsonMod.default)
  _plugins = [mod.default]
  _listeners.forEach((fn) => fn())
})

/** Returns rehype-highlight plugin list. Re-renders component when the plugin loads. */
export function useRehypeHighlight(): PluggableList {
  return useSyncExternalStore(
    (cb) => { _listeners.add(cb); return () => { _listeners.delete(cb) } },
    () => _plugins,
  )
}
