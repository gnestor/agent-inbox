import { useState, useEffect } from "react"
import { Popover, PopoverTrigger, PopoverContent } from "@hammies/frontend/components/ui"
import { SlidersHorizontal } from "lucide-react"
import { FilterCombobox } from "./FilterCombobox"
import type { FieldDef } from "@/types/plugin"
import { getFilterFields } from "@/lib/field-schema"

interface FilterPopoverProps {
  fieldSchema: FieldDef[]
  activeFilters: Record<string, string>
  onFilterChange: (key: string, value: string) => void
  /** Optional async fetchers for filter options, keyed by field ID */
  optionsFetcher?: Record<string, () => Promise<string[]>>
}

export function FilterPopover({ fieldSchema, activeFilters, onFilterChange, optionsFetcher }: FilterPopoverProps) {
  const filterFields = getFilterFields(fieldSchema)
  if (filterFields.length === 0) return null

  const hasActiveFilters = Object.values(activeFilters).some((v) => v.length > 0)

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={`shrink-0 p-1.5 rounded-md hover:bg-secondary ${hasActiveFilters ? "text-sidebar-primary" : "text-muted-foreground"}`}
            title="Filters"
          />
        }
      >
        <SlidersHorizontal className="h-4 w-4" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3 space-y-1.5">
        {filterFields.map((field) => (
          <FilterField
            key={field.id}
            field={field}
            value={(activeFilters[field.id] || "").split(",").filter(Boolean)}
            onChange={(vals) => onFilterChange(field.id, vals.join(","))}
            fetcher={optionsFetcher?.[field.id]}
          />
        ))}
      </PopoverContent>
    </Popover>
  )
}

function FilterField({
  field,
  value,
  onChange,
  fetcher,
}: {
  field: FieldDef
  value: string[]
  onChange: (vals: string[]) => void
  fetcher?: () => Promise<string[]>
}) {
  const staticOptions = Array.isArray(field.filter?.filterOptions)
    ? field.filter.filterOptions.map((o) => (typeof o === "string" ? { value: o, label: o } : o))
    : []

  const [asyncOptions, setAsyncOptions] = useState<{ value: string; label: string }[] | null>(null)

  useEffect(() => {
    if (!fetcher || staticOptions.length > 0) return
    fetcher().then((opts) => setAsyncOptions(opts.map((o) => ({ value: o, label: o })))).catch(() => {})
  }, [fetcher]) // eslint-disable-line react-hooks/exhaustive-deps

  const options = staticOptions.length > 0 ? staticOptions : asyncOptions ?? []

  return (
    <FilterCombobox
      value={value}
      onValueChange={onChange}
      items={options}
      placeholder={`${field.label}...`}
    />
  )
}
