import {
  Combobox,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
  ComboboxChips,
  ComboboxChip,
  ComboboxChipsInput,
  useComboboxAnchor,
} from "@hammies/frontend/components/ui"

type LabeledItem = { value: string; label: string }

interface FilterComboboxProps {
  value: string[]
  onValueChange: (value: string[]) => void
  items: string[] | LabeledItem[]
  placeholder: string
  emptyMessage?: string
  /** Map from value → display label for chips (only needed for labeled items) */
  labelMap?: Record<string, string>
}

export function FilterCombobox({
  value,
  onValueChange,
  items,
  placeholder,
  emptyMessage,
  labelMap,
}: FilterComboboxProps) {
  const anchor = useComboboxAnchor()
  const isLabeled = items.length > 0 && typeof items[0] === "object"

  return (
    <Combobox multiple value={value} onValueChange={onValueChange} items={items}>
      <ComboboxChips ref={anchor} className="min-h-8 text-xs">
        {value.map((v) => (
          <ComboboxChip key={v}>{labelMap?.[v] || v}</ComboboxChip>
        ))}
        <ComboboxChipsInput
          placeholder={value.length === 0 ? placeholder : ""}
          className="text-xs"
        />
      </ComboboxChips>
      <ComboboxContent anchor={anchor}>
        <ComboboxList>
          {isLabeled
            ? (item: LabeledItem) => (
                <ComboboxItem key={item.value} value={item.value}>
                  {item.label}
                </ComboboxItem>
              )
            : (item: string) => (
                <ComboboxItem key={item} value={item}>
                  {item}
                </ComboboxItem>
              )}
        </ComboboxList>
        {emptyMessage && <ComboboxEmpty>{emptyMessage}</ComboboxEmpty>}
      </ComboboxContent>
    </Combobox>
  )
}
