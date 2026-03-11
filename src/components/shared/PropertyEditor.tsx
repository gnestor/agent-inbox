import { useState } from "react"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Combobox,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
  ComboboxChips,
  ComboboxChip,
  ComboboxChipsInput,
  useComboboxAnchor,
  Popover,
  PopoverTrigger,
  PopoverContent,
  Calendar,
  Button,
} from "@hammies/frontend/components/ui"
import { cn } from "@hammies/frontend/lib/utils"
import { CalendarIcon, Loader2 } from "lucide-react"
import { format } from "date-fns"

interface PropertySelectProps {
  value: string
  options: { value: string; color?: string | null }[]
  onChange: (value: string) => void
  loading?: boolean
  className?: string
}

export function PropertySelect({
  value,
  options,
  onChange,
  loading,
  className,
}: PropertySelectProps) {
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <Select
        value={value}
        onValueChange={(val) => {
          if (val !== value) onChange(val as string)
        }}
      >
        <SelectTrigger size="sm" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.value}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
    </div>
  )
}

interface PropertyMultiSelectProps {
  value: string[]
  options: { value: string; color?: string | null }[]
  onChange: (value: string[]) => void
  loading?: boolean
  placeholder?: string
  className?: string
}

export function PropertyMultiSelect({
  value,
  options,
  onChange,
  loading,
  placeholder = "Add...",
  className,
}: PropertyMultiSelectProps) {
  const anchor = useComboboxAnchor()

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <Combobox
        multiple
        value={value}
        onValueChange={(val) => onChange(val as string[])}
        items={options.map((o) => o.value)}
      >
        <ComboboxChips ref={anchor} className="min-h-8 text-xs">
          {value.map((v) => (
            <ComboboxChip key={v}>{v}</ComboboxChip>
          ))}
          <ComboboxChipsInput placeholder={value.length === 0 ? placeholder : ""} className="text-xs" />
        </ComboboxChips>
        <ComboboxContent anchor={anchor}>
          <ComboboxList>
            {options.map((opt) => (
              <ComboboxItem key={opt.value} value={opt.value}>
                {opt.value}
              </ComboboxItem>
            ))}
            <ComboboxEmpty>No options</ComboboxEmpty>
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
    </div>
  )
}

interface PropertyPersonProps {
  value: string
  options: string[]
  onChange: (value: string) => void
  loading?: boolean
  className?: string
}

export function PropertyPerson({
  value,
  options,
  onChange,
  loading,
  className,
}: PropertyPersonProps) {
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <Select
        value={value}
        onValueChange={(val) => {
          if (val !== value) onChange(val as string)
        }}
      >
        <SelectTrigger size="sm" className="w-full">
          <SelectValue placeholder="Unassigned" />
        </SelectTrigger>
        <SelectContent>
          {options.map((name) => (
            <SelectItem key={name} value={name}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
    </div>
  )
}

interface PropertyDateProps {
  value: string | undefined
  onChange: (date: string) => void
  loading?: boolean
  className?: string
}

export function PropertyDate({
  value,
  onChange,
  loading,
  className,
}: PropertyDateProps) {
  const [open, setOpen] = useState(false)
  const selected = value ? new Date(value) : undefined

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs font-normal justify-start"
            />
          }
        >
          <CalendarIcon className="h-3 w-3 mr-1.5 text-muted-foreground" />
          {selected ? format(selected, "MMM d, yyyy") : "Set date"}
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selected}
            onSelect={(date) => {
              if (date) {
                onChange(format(date, "yyyy-MM-dd"))
                setOpen(false)
              }
            }}
            autoFocus
          />
        </PopoverContent>
      </Popover>
      {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
    </div>
  )
}
