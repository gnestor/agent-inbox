import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { WidgetDef } from "@/types/panels"

function getNestedValue(obj: Record<string, unknown>, dotPath: string): unknown {
  return dotPath.split(".").reduce<unknown>((cur, key) => {
    if (cur && typeof cur === "object") return (cur as Record<string, unknown>)[key]
    return undefined
  }, obj)
}

function KvTableWidget({ fields, data }: { fields: string[]; data: Record<string, unknown> }) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {fields.map((f) => {
          const val = getNestedValue(data, f)
          if (val == null) return null
          return (
            <tr key={f} className="border-b last:border-0">
              <td className="py-1 pr-3 font-medium text-muted-foreground capitalize w-1/3">
                {f.replace(/([A-Z])/g, " $1").replace(/_/g, " ")}
              </td>
              <td className="py-1">{String(val)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function ProseWidget({
  field,
  data,
}: {
  field: string
  format?: string
  data: Record<string, unknown>
}) {
  const content = getNestedValue(data, field)
  if (!content) return null
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{String(content)}</ReactMarkdown>
    </div>
  )
}

function JsonFallback({ data }: { data: unknown }) {
  return (
    <pre className="text-xs bg-muted rounded p-3 overflow-x-auto">
      {JSON.stringify(data, null, 2)}
    </pre>
  )
}

interface PanelWidgetProps {
  widgets: WidgetDef[]
  data: Record<string, unknown>
  onMutate?: (mutation: string, payload: unknown) => void
}

export function PanelWidget({ widgets, data, onMutate }: PanelWidgetProps) {
  return (
    <div className="space-y-3">
      {widgets.map((widget, i) => {
        if (widget.type === "kv-table") {
          return (
            <div key={i} className="rounded border p-3">
              <KvTableWidget fields={widget.fields} data={data} />
            </div>
          )
        }
        if (widget.type === "prose") {
          return (
            <div key={i}>
              <ProseWidget field={widget.field} format={widget.format} data={data} />
            </div>
          )
        }
        if (widget.type === "badge-row") {
          const val = getNestedValue(data, widget.field)
          const values = Array.isArray(val) ? val : val ? [val] : []
          return (
            <div key={i} className="flex flex-wrap gap-1">
              {values.map((v, j) => (
                <span
                  key={j}
                  className="rounded-full bg-secondary text-secondary-foreground text-xs px-2 py-0.5"
                >
                  {String(v)}
                </span>
              ))}
            </div>
          )
        }
        if (widget.type === "action-buttons") {
          return (
            <div key={i} className="flex gap-2 flex-wrap">
              {widget.actions.map((action) => (
                <button
                  key={action.mutation}
                  className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={() => {
                    const payload = action.payloadField
                      ? getNestedValue(data, action.payloadField)
                      : data
                    onMutate?.(action.mutation, payload)
                  }}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )
        }
        if (widget.type === "json-tree") {
          return <JsonFallback key={i} data={getNestedValue(data, widget.field)} />
        }
        return <JsonFallback key={i} data={data} />
      })}
    </div>
  )
}
