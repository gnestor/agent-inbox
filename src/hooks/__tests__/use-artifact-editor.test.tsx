// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import {
  setEditingCode,
  clearEditingCode,
  getEditingCode,
  useEditingCode,
  artifactEditorKey,
} from "../use-artifact-editor"

describe("use-artifact-editor", () => {
  beforeEach(() => {
    clearEditingCode(artifactEditorKey("s1", 0))
  })

  it("Scenario: `setEditingCode` notifies all subscribers synchronously — every subscriber re-renders in the same tick", () => {
    const key = artifactEditorKey("s1", 0)
    const a = renderHook(() => useEditingCode(key))
    const b = renderHook(() => useEditingCode(key))

    act(() => setEditingCode(key, "const x = 1"))

    // Both subscribers see the new value synchronously after the dispatch.
    expect(a.result.current).toBe("const x = 1")
    expect(b.result.current).toBe("const x = 1")
    expect(getEditingCode(key)).toBe("const x = 1")
  })

  it("Scenario: Listener sets are cleaned up when last subscriber unmounts — value persists, no error when re-subscribing", () => {
    const key = artifactEditorKey("s1", 0)
    const first = renderHook(() => useEditingCode(key))
    act(() => setEditingCode(key, "v1"))
    expect(first.result.current).toBe("v1")

    // Unmount the last subscriber — internal listener Set is removed.
    first.unmount()

    // A fresh subscriber still reads the stored value and receives new notifications.
    const second = renderHook(() => useEditingCode(key))
    expect(second.result.current).toBe("v1")
    act(() => setEditingCode(key, "v2"))
    expect(second.result.current).toBe("v2")
  })

  it("Scenario: `artifactEditorKey(sessionId, sequence)` is the canonical key — derives `artifact:${sessionId}:${sequence}`", () => {
    expect(artifactEditorKey("abc", 7)).toBe("artifact:abc:7")
  })
})
