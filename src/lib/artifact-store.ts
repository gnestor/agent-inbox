/**
 * In-memory store for artifact OutputSpec instances.
 * Keyed by "artifact:{sessionId}:{sequence}".
 *
 * Populated when an output panel is opened from SessionView,
 * consumed by PanelContent when rendering the artifact panel.
 */

import type { OutputSpec } from "@/components/session/OutputRenderer"

const store = new Map<string, OutputSpec>()

export function setArtifactSpec(sessionId: string, sequence: number, spec: OutputSpec): void {
  store.set(`artifact:${sessionId}:${sequence}`, spec)
}

export function getArtifactSpec(sessionId: string, sequence: number): OutputSpec | undefined {
  return store.get(`artifact:${sessionId}:${sequence}`)
}
