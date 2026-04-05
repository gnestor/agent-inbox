// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useAskUserForm } from "../use-ask-user-form"
import type { AskUserQuestion } from "@/types"

const singleSelectQuestion: AskUserQuestion = {
  question: "What priority?",
  header: "Priority",
  options: [
    { label: "High", description: "Urgent" },
    { label: "Medium", description: "Normal" },
    { label: "Low", description: "Can wait" },
  ],
  multiSelect: false,
}

const multiSelectQuestion: AskUserQuestion = {
  question: "Which tags?",
  header: "Tags",
  options: [
    { label: "Bug", description: "A bug" },
    { label: "Feature", description: "A feature" },
    { label: "Docs", description: "Documentation" },
  ],
  multiSelect: true,
}

describe("useAskUserForm", () => {
  it("initializes with empty selections for each question", () => {
    const { result } = renderHook(() => useAskUserForm([singleSelectQuestion, multiSelectQuestion]))

    expect(result.current.selections).toEqual({
      "What priority?": [],
      "Which tags?": [],
    })
    expect(result.current.submitting).toBe(false)
  })

  it("toggleOption selects an option for single-select question", () => {
    const { result } = renderHook(() => useAskUserForm([singleSelectQuestion]))

    act(() => {
      result.current.toggleOption(singleSelectQuestion, "High")
    })

    expect(result.current.selections["What priority?"]).toEqual(["High"])
  })

  it("toggleOption replaces selection on single-select (not appends)", () => {
    const { result } = renderHook(() => useAskUserForm([singleSelectQuestion]))

    act(() => {
      result.current.toggleOption(singleSelectQuestion, "High")
    })
    act(() => {
      result.current.toggleOption(singleSelectQuestion, "Medium")
    })

    expect(result.current.selections["What priority?"]).toEqual(["Medium"])
  })

  it("toggleOption allows multiple selections for multi-select question", () => {
    const { result } = renderHook(() => useAskUserForm([multiSelectQuestion]))

    act(() => {
      result.current.toggleOption(multiSelectQuestion, "Bug")
    })
    act(() => {
      result.current.toggleOption(multiSelectQuestion, "Feature")
    })

    expect(result.current.selections["Which tags?"]).toEqual(["Bug", "Feature"])
  })

  it("toggleOption deselects on multi-select when toggling same option", () => {
    const { result } = renderHook(() => useAskUserForm([multiSelectQuestion]))

    act(() => {
      result.current.toggleOption(multiSelectQuestion, "Bug")
    })
    act(() => {
      result.current.toggleOption(multiSelectQuestion, "Bug")
    })

    expect(result.current.selections["Which tags?"]).toEqual([])
  })

  it("setOther clears regular selections on single-select", () => {
    const { result } = renderHook(() => useAskUserForm([singleSelectQuestion]))

    act(() => {
      result.current.toggleOption(singleSelectQuestion, "High")
    })
    expect(result.current.selections["What priority?"]).toEqual(["High"])

    act(() => {
      result.current.setOther("What priority?", "Custom priority")
    })

    expect(result.current.selections["What priority?"]).toEqual([])
    expect(result.current.otherText["What priority?"]).toBe("Custom priority")
  })

  it("toggleOption clears otherText on single-select", () => {
    const { result } = renderHook(() => useAskUserForm([singleSelectQuestion]))

    act(() => {
      result.current.setOther("What priority?", "Custom")
    })
    act(() => {
      result.current.toggleOption(singleSelectQuestion, "High")
    })

    expect(result.current.otherText["What priority?"]).toBe("")
  })

  it("isComplete returns false when no question is answered", () => {
    const { result } = renderHook(() => useAskUserForm([singleSelectQuestion]))

    expect(result.current.isComplete()).toBe(false)
  })

  it("isComplete returns true when all questions have a selection", () => {
    const { result } = renderHook(() => useAskUserForm([singleSelectQuestion]))

    act(() => {
      result.current.toggleOption(singleSelectQuestion, "High")
    })

    expect(result.current.isComplete()).toBe(true)
  })

  it("isComplete returns true when answered via otherText", () => {
    const { result } = renderHook(() => useAskUserForm([singleSelectQuestion]))

    act(() => {
      result.current.setOther("What priority?", "Custom answer")
    })

    expect(result.current.isComplete()).toBe(true)
  })

  it("handleSubmit builds answers and calls onSubmit", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useAskUserForm([singleSelectQuestion, multiSelectQuestion]))

    act(() => {
      result.current.toggleOption(singleSelectQuestion, "High")
      result.current.toggleOption(multiSelectQuestion, "Bug")
      result.current.toggleOption(multiSelectQuestion, "Feature")
    })

    await act(async () => {
      await result.current.handleSubmit(onSubmit)
    })

    expect(onSubmit).toHaveBeenCalledWith({
      "What priority?": "High",
      "Which tags?": "Bug, Feature",
    })
  })

  it("handleSubmit includes Other text in answers", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useAskUserForm([multiSelectQuestion]))

    act(() => {
      result.current.toggleOption(multiSelectQuestion, "Bug")
      result.current.setOther("Which tags?", "Custom tag")
    })

    await act(async () => {
      await result.current.handleSubmit(onSubmit)
    })

    expect(onSubmit).toHaveBeenCalledWith({
      "Which tags?": "Bug, Other: Custom tag",
    })
  })

  it("handleSubmit sets submitting=true during call and false after", async () => {
    let resolveSubmit: () => void
    const onSubmit = vi.fn().mockImplementation(
      () => new Promise<void>((resolve) => { resolveSubmit = resolve }),
    )
    const { result } = renderHook(() => useAskUserForm([singleSelectQuestion]))

    act(() => {
      result.current.toggleOption(singleSelectQuestion, "High")
    })

    let submitPromise: Promise<void>
    act(() => {
      submitPromise = result.current.handleSubmit(onSubmit)
    })

    expect(result.current.submitting).toBe(true)

    await act(async () => {
      resolveSubmit!()
      await submitPromise!
    })

    expect(result.current.submitting).toBe(false)
  })

  it("handleSubmit resets submitting even if onSubmit throws", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("fail"))
    const { result } = renderHook(() => useAskUserForm([singleSelectQuestion]))

    act(() => {
      result.current.toggleOption(singleSelectQuestion, "High")
    })

    await act(async () => {
      try {
        await result.current.handleSubmit(onSubmit)
      } catch {}
    })

    expect(result.current.submitting).toBe(false)
  })
})
