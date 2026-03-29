// src/lib/navigation-constants.ts

/** Cubic bezier easing for tab and item transitions */
export const EASE: [number, number, number, number] = [0.32, 0.72, 0, 1]

/** CSS cubic-bezier() string for inline styles */
export const EASE_CSS = `cubic-bezier(${EASE.join(",")})`

/** Duration in seconds for tab and item transitions */
export const DURATION = 0.6

/** Gap in pixels between panels during list item navigation */
export const ITEM_GAP = 16

/** Panel card styling class */
export const PANEL_CARD = "shrink-0 h-full w-[600px] bg-card rounded-lg shadow-sm ring-1 ring-inset ring-border overflow-hidden"

/** Default panel width in pixels */
export const DEFAULT_PANEL_WIDTH = 600

/** Active tab sidebar highlight classes (primary color, overrides SidebarMenuButton's default secondary) */
export const ACTIVE_TAB_CLASSES = "bg-primary! text-primary-foreground! hover:bg-primary! hover:text-primary-foreground!"
export const ACTIVE_TAB_CLASS_LIST = ACTIVE_TAB_CLASSES.split(" ")
