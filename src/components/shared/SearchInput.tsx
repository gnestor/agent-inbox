import { Search, X } from "lucide-react"

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export function SearchInput({ value, onChange, placeholder = "Search..." }: SearchInputProps) {
  return (
    <div className="px-2 py-2 border-b">
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-card">
        <Search className="h-3 w-3 text-muted-foreground shrink-0" />
        <input
          className="flex-1 text-sm bg-transparent outline-none w-full placeholder:text-muted-foreground"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="shrink-0 p-0.5 rounded hover:bg-secondary"
          >
            <X className="h-3 w-3 text-muted-foreground" />
          </button>
        )}
      </div>
    </div>
  )
}
