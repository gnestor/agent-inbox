import { Checkbox } from "@hammies/frontend/components/ui"
import { cn } from "@hammies/frontend/lib/utils"
import type { AskUserQuestion } from "@/types"
import type { AskUserFormState } from "@/hooks/use-ask-user-form"

interface AskUserFormProps {
  questions: AskUserQuestion[]
  form: AskUserFormState
  onSubmit: () => void
}

export function AskUserForm({ questions, form, onSubmit }: AskUserFormProps) {
  const { selections, otherText, submitting, toggleOption, setOther, isComplete } = form

  return (
    <div className="space-y-3">
      {questions.map((q) => (
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
              const isSelected = (selections[q.question] ?? []).includes(opt.label)
              return (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => toggleOption(q, opt.label)}
                  className={cn(
                    "w-full text-left rounded-md border px-3 py-2 text-sm transition-colors",
                    isSelected
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:bg-muted/50",
                  )}
                >
                  <div className="flex items-start gap-2">
                    {q.multiSelect ? (
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleOption(q, opt.label)}
                        className="mt-0.5 shrink-0"
                      />
                    ) : (
                      <div
                        className={cn(
                          "mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 transition-colors",
                          isSelected ? "border-primary bg-primary" : "border-muted-foreground",
                        )}
                      />
                    )}
                    <div className="min-w-0">
                      <div className="font-medium">{opt.label}</div>
                      {opt.description && (
                        <div className="text-xs text-muted-foreground mt-0.5">{opt.description}</div>
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
                    : "border-border bg-card hover:bg-muted/50",
                )}
              >
                <div className="flex items-center gap-2">
                  {q.multiSelect ? (
                    <Checkbox
                      checked={!!otherText[q.question]?.trim()}
                      onCheckedChange={() => {
                        if (otherText[q.question]?.trim()) {
                          setOther(q.question, "")
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
              {otherText[q.question] !== undefined && (
                <input
                  value={otherText[q.question] ?? ""}
                  onChange={(e) => setOther(q.question, e.target.value)}
                  placeholder="Describe your choice..."
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  autoFocus
                />
              )}
            </div>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={onSubmit}
        disabled={!isComplete() || submitting}
        className={cn(
          "w-full rounded-md px-3 py-2 text-sm font-medium transition-colors",
          isComplete() && !submitting
            ? "bg-primary text-primary-foreground hover:bg-primary/90"
            : "bg-muted text-muted-foreground cursor-not-allowed",
        )}
      >
        {submitting ? "Submitting..." : "Continue"}
      </button>
    </div>
  )
}
