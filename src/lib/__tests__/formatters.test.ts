import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  formatRelativeDate,
  formatTimeAgo,
  formatEmailAddress,
  truncate,
  sessionStatusLabel,
  sessionStatusColor,
  sessionStatusBadgeClass,
  taskStatusBadgeClass,
} from "../formatters"

describe("formatRelativeDate", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2025-06-15T10:30:00Z"))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("returns time for today", () => {
    const result = formatRelativeDate("2025-06-15T08:15:00Z")
    expect(result).toMatch(/\d{1,2}:\d{2}\s[AP]M/i)
  })

  it("returns 'Yesterday' for yesterday", () => {
    expect(formatRelativeDate("2025-06-14T12:00:00Z")).toBe("Yesterday")
  })

  it("returns 'MMM d' for this year", () => {
    expect(formatRelativeDate("2025-03-05T12:00:00Z")).toBe("Mar 5")
  })

  it("returns 'MMM d, yyyy' for a different year", () => {
    expect(formatRelativeDate("2023-12-25T12:00:00Z")).toBe("Dec 25, 2023")
  })

  it("returns empty string for invalid date", () => {
    expect(formatRelativeDate("not-a-date")).toBe("")
  })
})

describe("formatTimeAgo", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2025-06-15T10:30:00Z"))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("returns a relative time string", () => {
    const result = formatTimeAgo("2025-06-15T10:25:00Z")
    expect(result).toContain("ago")
  })
})

describe("formatEmailAddress", () => {
  it("extracts name from 'Name <email>' format", () => {
    expect(formatEmailAddress("John Doe <john@example.com>")).toBe("John Doe")
  })

  it("strips quotes from name", () => {
    expect(formatEmailAddress('"Jane Doe" <jane@example.com>')).toBe("Jane Doe")
  })

  it("returns bare email as-is", () => {
    expect(formatEmailAddress("plain@example.com")).toBe("plain@example.com")
  })

  it("handles name with special chars", () => {
    expect(formatEmailAddress("O'Brien, Tim <tim@co.com>")).toBe("O'Brien, Tim")
  })
})

describe("truncate", () => {
  it("returns string unchanged when under limit", () => {
    expect(truncate("hello", 10)).toBe("hello")
  })

  it("truncates and appends ellipsis when over limit", () => {
    expect(truncate("hello world", 6)).toBe("hello\u2026")
  })

  it("returns string unchanged at exact limit", () => {
    expect(truncate("hello", 5)).toBe("hello")
  })
})

describe("sessionStatusLabel", () => {
  it.each([
    ["running", "Running"],
    ["complete", "Complete"],
    ["needs_attention", "Needs Attention"],
    ["errored", "Error"],
  ])("maps '%s' to '%s'", (input, expected) => {
    expect(sessionStatusLabel(input)).toBe(expected)
  })

  it("returns unknown status as-is", () => {
    expect(sessionStatusLabel("unknown")).toBe("unknown")
  })
})

describe("sessionStatusColor", () => {
  it.each([
    ["running", "text-chart-3"],
    ["complete", "text-chart-1"],
    ["needs_attention", "text-chart-2"],
    ["errored", "text-destructive"],
  ])("maps '%s' to '%s'", (input, expected) => {
    expect(sessionStatusColor(input)).toBe(expected)
  })

  it("returns muted foreground for unknown status", () => {
    expect(sessionStatusColor("unknown")).toBe("text-muted-foreground")
  })
})

describe("sessionStatusBadgeClass", () => {
  it.each([
    ["running", "bg-chart-3/20 text-chart-3 border-chart-3/30"],
    ["complete", "bg-chart-1/20 text-chart-1 border-chart-1/30"],
    ["needs_attention", "bg-chart-2/20 text-chart-2 border-chart-2/30"],
    ["errored", "bg-destructive/20 text-destructive border-destructive/30"],
  ])("maps '%s' correctly", (input, expected) => {
    expect(sessionStatusBadgeClass(input)).toBe(expected)
  })

  it("returns empty string for unknown status", () => {
    expect(sessionStatusBadgeClass("unknown")).toBe("")
  })
})

describe("taskStatusBadgeClass", () => {
  it.each([
    ["Not started", "bg-muted-foreground/20 text-muted-foreground border-muted-foreground/30"],
    ["Next Up", "bg-chart-2/20 text-chart-2 border-chart-2/30"],
    ["In Progress", "bg-chart-3/20 text-chart-3 border-chart-3/30"],
    ["In progress", "bg-chart-3/20 text-chart-3 border-chart-3/30"],
    ["Completed", "bg-chart-1/20 text-chart-1 border-chart-1/30"],
    ["Done", "bg-chart-1/20 text-chart-1 border-chart-1/30"],
    ["Archive", "bg-muted-foreground/20 text-muted-foreground border-muted-foreground/30"],
  ])("maps '%s' correctly", (input, expected) => {
    expect(taskStatusBadgeClass(input)).toBe(expected)
  })

  it("returns empty string for unknown status", () => {
    expect(taskStatusBadgeClass("unknown")).toBe("")
  })
})
