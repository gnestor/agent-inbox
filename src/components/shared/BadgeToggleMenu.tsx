import {
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuCheckboxItem,
} from "@hammies/frontend/components/ui"
import { Ellipsis } from "lucide-react"

interface BadgeToggleItem {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}

interface BadgeToggleMenuProps {
  items: BadgeToggleItem[]
}

export function BadgeToggleMenu({ items }: BadgeToggleMenuProps) {
  if (items.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
          />
        }
      >
        <Ellipsis className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Toggle badges</DropdownMenuLabel>
          {items.map((item) => (
            <DropdownMenuCheckboxItem
              key={item.label}
              checked={item.checked}
              onCheckedChange={item.onChange}
            >
              {item.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
