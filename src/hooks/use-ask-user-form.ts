import { useState, useCallback } from "react"
import type { AskUserQuestion } from "@/types"

export interface AskUserFormState {
  selections: Record<string, string[]>
  otherText: Record<string, string>
  submitting: boolean
  toggleOption: (question: AskUserQuestion, label: string) => void
  setOther: (questionText: string, value: string) => void
  isComplete: () => boolean
  handleSubmit: (onSubmit: (answers: Record<string, string>) => Promise<void>) => Promise<void>
}

export function useAskUserForm(questions: AskUserQuestion[]): AskUserFormState {
  const [selections, setSelections] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(questions.map((q) => [q.question, []])),
  )
  const [otherText, setOtherText] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  const toggleOption = useCallback((question: AskUserQuestion, label: string) => {
    setSelections((prev) => {
      const current = prev[question.question] ?? []
      if (question.multiSelect) {
        return {
          ...prev,
          [question.question]: current.includes(label)
            ? current.filter((l) => l !== label)
            : [...current, label],
        }
      }
      return { ...prev, [question.question]: [label] }
    })
    // Clear "Other" when a regular option is picked on single-select
    if (!question.multiSelect) {
      setOtherText((prev) => ({ ...prev, [question.question]: "" }))
    }
  }, [])

  const setOther = useCallback((questionText: string, value: string) => {
    setOtherText((prev) => ({ ...prev, [questionText]: value }))
    // Selecting Other clears regular options on single-select
    const q = questions.find((q) => q.question === questionText)
    if (q && !q.multiSelect) {
      setSelections((prev) => ({ ...prev, [questionText]: [] }))
    }
  }, [questions])

  const isComplete = useCallback((): boolean => {
    return questions.every((q) => {
      const sel = selections[q.question] ?? []
      const other = otherText[q.question] ?? ""
      return sel.length > 0 || other.trim().length > 0
    })
  }, [questions, selections, otherText])

  const handleSubmit = useCallback(async (onSubmit: (answers: Record<string, string>) => Promise<void>) => {
    setSubmitting(true)
    const answers: Record<string, string> = {}
    for (const q of questions) {
      const sel = selections[q.question] ?? []
      const other = (otherText[q.question] ?? "").trim()
      const parts = [...sel, ...(other ? [`Other: ${other}`] : [])]
      answers[q.question] = parts.join(", ")
    }
    try {
      await onSubmit(answers)
    } finally {
      setSubmitting(false)
    }
  }, [questions, selections, otherText])

  return { selections, otherText, submitting, toggleOption, setOther, isComplete, handleSubmit }
}
