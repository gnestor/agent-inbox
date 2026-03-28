# App Component Examples

Patterns extracted from real components in the Inbox app. Use these as inspiration for artifact design — they show the app's actual design language.

## Data Table with Sort & Search

Based on `DataTable.tsx`. The app uses TanStack Table for sortable, filterable tables.

```jsx
// Simplified pattern for artifacts — no TanStack dependency needed
export default function DataTableArtifact({ data }) {
  const [sortKey, setSortKey] = useState(null)
  const [sortDir, setSortDir] = useState('asc')
  const [search, setSearch] = useState('')

  const columns = Object.keys(data[0] || {})
  const filtered = data.filter((row) =>
    columns.some((col) => String(row[col]).toLowerCase().includes(search.toLowerCase()))
  )
  const sorted = [...filtered].sort((a, b) => {
    if (!sortKey) return 0
    const cmp = String(a[sortKey]).localeCompare(String(b[sortKey]))
    return sortDir === 'asc' ? cmp : -cmp
  })

  return (
    <div className="flex flex-col gap-3">
      <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((col) => (
                <TableHead key={col} className="cursor-pointer select-none"
                  onClick={() => { setSortKey(col); setSortDir(sortDir === 'asc' ? 'desc' : 'asc') }}>
                  {col} {sortKey === col ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((row, i) => (
              <TableRow key={i}>
                {columns.map((col) => (
                  <TableCell key={col}>{row[col] ?? '—'}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">{sorted.length} of {data.length} rows</p>
    </div>
  )
}
```

## List View with Badges and Selection

Based on `ListView.tsx` + `ListItem.tsx`. Shows the app's list item pattern with title, subtitle, timestamp, and badges.

```jsx
export default function ListArtifact({ items }) {
  const [selected, setSelected] = useState(null)

  return (
    <div className="flex flex-col">
      {items.map((item) => (
        <div
          key={item.id}
          className={cn(
            "flex items-center gap-3 px-4 py-3 border-b cursor-pointer",
            selected === item.id ? "bg-secondary" : "hover:bg-secondary/50"
          )}
          onClick={() => { setSelected(item.id); sendAction('select', { id: item.id }) }}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium truncate">{item.title}</span>
              <span className="text-xs text-muted-foreground shrink-0">{item.date}</span>
            </div>
            <p className="text-xs text-muted-foreground truncate">{item.subtitle}</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {item.badges?.map((b) => (
              <Badge key={b.label} variant="secondary" className={b.color}>
                {b.label}
              </Badge>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
```

## Message Thread with Avatars

Based on `PluginDetail.tsx` `MessageRow`. Shows the app's message/conversation pattern.

```jsx
function MessageRow({ message }) {
  const initials = (message.userName || 'U').slice(0, 2).toUpperCase()

  return (
    <div className="px-4 py-3 border-b last:border-0 hover:bg-secondary">
      <div className="flex gap-2.5">
        {message.avatar ? (
          <img src={message.avatar} alt="" className="h-8 w-8 rounded-full shrink-0 mt-0.5" />
        ) : (
          <div className="h-8 w-8 rounded-full shrink-0 mt-0.5 bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground">
            {initials}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 mb-0.5">
            <span className="font-medium text-sm">{message.userName}</span>
            <span className="text-xs text-muted-foreground">{message.time}</span>
          </div>
          <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
            {message.text}
          </p>
        </div>
      </div>
    </div>
  )
}
```

## Property Editor

Based on `PropertyEditor.tsx`. Shows inline editable fields for status, tags, and assignees.

```jsx
function PropertyRow({ label, children }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="text-xs text-muted-foreground w-24 shrink-0">{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  )
}

<div className="flex flex-col">
  <PropertyRow label="Status">
    <Select value={status} onValueChange={(v) => { setStatus(v); sendAction('update', { field: 'status', value: v }) }}>
      <SelectTrigger className="h-8 text-sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="open">Open</SelectItem>
        <SelectItem value="in-progress">In Progress</SelectItem>
        <SelectItem value="done">Done</SelectItem>
      </SelectContent>
    </Select>
  </PropertyRow>
  <PropertyRow label="Priority">
    <Badge variant="outline">{priority}</Badge>
  </PropertyRow>
  <PropertyRow label="Tags">
    <div className="flex flex-wrap gap-1">
      {tags.map((t) => <Badge key={t} variant="secondary">{t}</Badge>)}
    </div>
  </PropertyRow>
</div>
```

## Search Input with Clear

Based on `SearchInput.tsx`. Compact search field with icon and clear button.

```jsx
function SearchField({ value, onChange, placeholder = "Search..." }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border rounded-md">
      <svg className="h-4 w-4 text-muted-foreground shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
      </svg>
      <input
        className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {value && (
        <button className="p-0.5 rounded hover:bg-secondary text-muted-foreground" onClick={() => onChange('')}>
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  )
}
```

## Empty State

Based on `EmptyState.tsx`. Centered message for when there's no data.

```jsx
<div className="flex flex-col items-center justify-center py-12 text-center">
  <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center mb-3">
    {/* Icon */}
    <svg className="h-5 w-5 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  </div>
  <p className="text-sm font-medium">No messages yet</p>
  <p className="text-xs text-muted-foreground mt-1">Start a conversation to see messages here</p>
</div>
```

## Panel Header

Based on `PanelHeader.tsx`. Fixed header with left/right content areas.

```jsx
<div className="flex items-center justify-between h-12 px-4 border-b shrink-0">
  <div className="flex items-center gap-2">
    <span className="text-sm font-semibold">{title}</span>
    <Badge variant="outline">{count}</Badge>
  </div>
  <div className="flex items-center gap-1">
    <button className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground">
      {/* Action icon */}
    </button>
  </div>
</div>
```
