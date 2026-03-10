import { useState } from "react"
import { Button, Checkbox, Input } from "@hammies/frontend/components/ui"
import { cn } from "@hammies/frontend/lib/utils"
import { Loader2 } from "lucide-react"
import type { PendingQuestion, AskUserQuestion } from "@/types"

interface AskUserPanelProps {
  pendingQuestion: PendingQuestion
  onSubmit: (answers: Record<string, string>) => Promise<void>
}

export function AskUserPanel({ pendingQuestion, onSubmit }: AskUserPanelProps) {
  // Track selections per question: question text → selected option labels (for multi) or single label
  const [selections, setSelections] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(pendingQuestion.questions.map((q) => [q.question, []])),
  )
  const [otherText, setOtherText] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  function toggleOption(question: AskUserQuestion, label: string) {
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
  }

  function setOther(questionText: string, value: string) {
    setOtherText((prev) => ({ ...prev, [questionText]: value }))
    // Selecting Other clears regular options on single-select
    const q = pendingQuestion.questions.find((q) => q.question === questionText)
    if (q && !q.multiSelect) {
      setSelections((prev) => ({ ...prev, [questionText]: [] }))
    }
  }

  function isComplete(): boolean {
    return pendingQuestion.questions.every((q) => {
      const sel = selections[q.question] ?? []
      const other = otherText[q.question] ?? ""
      return sel.length > 0 || other.trim().length > 0
    })
  }

  async function handleSubmit() {
    setSubmitting(true)
    const answers: Record<string, string> = {}
    for (const q of pendingQuestion.questions) {
      const sel = selections[q.question] ?? []
      const other = (otherText[q.question] ?? "").trim()
      const parts = [...sel, ...(other ? [`Other: ${other}`] : [])]
      answers[q.question] = parts.join(", ")
    }
    await onSubmit(answers)
    setSubmitting(false)
  }

  return (
    <div className="border-t">
      <div className="p-3 space-y-4 overflow-y-auto max-h-[60vh]">
        {pendingQuestion.questions.map((q) => (
          <div key={q.question} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide bg-muted px-1.5 py-0.5 rounded">
                {q.header}
              </span>
              {q.multiSelect && (
                <span className="text-[10px] text-muted-foreground">Select all that apply</span>
              )}
            </div>
            <p className="text-sm font-medium">{q.question}</p>
            <div className="space-y-1">
              {q.options.map((opt) => {
                const selected = (selections[q.question] ?? []).includes(opt.label)
                return (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => toggleOption(q, opt.label)}
                    className={cn(
                      "w-full text-left rounded-md border px-3 py-2 text-sm transition-colors",
                      selected
                        ? "border-primary bg-primary/5"
                        : "border-border bg-background hover:bg-muted/50",
                    )}
                  >
                    <div className="flex items-start gap-2">
                      {q.multiSelect ? (
                        <Checkbox
                          checked={selected}
                          onCheckedChange={() => toggleOption(q, opt.label)}
                          className="mt-0.5 shrink-0"
                        />
                      ) : (
                        <div
                          className={cn(
                            "mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 transition-colors",
                            selected ? "border-primary bg-primary" : "border-muted-foreground",
                          )}
                        />
                      )}
                      <div className="min-w-0">
                        <div className="font-medium">{opt.label}</div>
                        {opt.description && (
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {opt.description}
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })}

              {/* Other option */}
              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => {
                    if (!otherText[q.question]) setOther(q.question, " ")
                  }}
                  className={cn(
                    "w-full text-left rounded-md border px-3 py-2 text-sm transition-colors",
                    otherText[q.question]?.trim()
                      ? "border-primary bg-primary/5"
                      : "border-border bg-background hover:bg-muted/50",
                  )}
                >
                  <div className="flex items-center gap-2">
                    {q.multiSelect ? (
                      <Checkbox
                        checked={!!otherText[q.question]?.trim()}
                        onCheckedChange={() => {
                          if (otherText[q.question]?.trim()) {
                            setOtherText((prev) => ({ ...prev, [q.question]: "" }))
                          } else {
                            setOther(q.question, " ")
                          }
                        }}
                        className="shrink-0"
                      />
                    ) : (
                      <div
                        className={cn(
                          "h-4 w-4 shrink-0 rounded-full border-2 transition-colors",
                          otherText[q.question]?.trim()
                            ? "border-primary bg-primary"
                            : "border-muted-foreground",
                        )}
                      />
                    )}
                    <span className="font-medium">Other</span>
                  </div>
                </button>
                {(otherText[q.question] !== undefined || otherText[q.question] === "") && (
                  <Input
                    value={otherText[q.question] ?? ""}
                    onChange={(e) => setOther(q.question, e.target.value)}
                    placeholder="Describe your choice..."
                    className="text-sm"
                    autoFocus
                  />
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="px-3 pb-3">
        <Button
          onClick={handleSubmit}
          disabled={!isComplete() || submitting}
          className="w-full"
          size="sm"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Continue
        </Button>
      </div>
    </div>
  )
}
