import { Popover, PopoverTrigger, PopoverContent } from "@hammies/frontend/components/ui"
import { SlidersHorizontal } from "lucide-react"
import { FilterCombobox } from "./FilterCombobox"
import type { FieldDef } from "@/types/plugin"
import { getFilterFields } from "@/lib/field-schema"

interface FilterPopoverProps {
  fieldSchema: FieldDef[]
  activeFilters: Record<string, string>
  onFilterChange: (key: string, value: string) => void
}

export function FilterPopover({ fieldSchema, activeFilters, onFilterChange }: FilterPopoverProps) {
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
        {filterFields.map((field) => {
          const options = Array.isArray(field.filter?.filterOptions)
            ? field.filter.filterOptions.map((o) => (typeof o === "string" ? { value: o, label: o } : o))
            : []

          return (
            <FilterCombobox
              key={field.id}
              value={(activeFilters[field.id] || "").split(",").filter(Boolean)}
              onValueChange={(vals) => onFilterChange(field.id, vals.join(","))}
              items={options}
              placeholder={`${field.label}...`}
            />
          )
        })}
      </PopoverContent>
    </Popover>
  )
}
