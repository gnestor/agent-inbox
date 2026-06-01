// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { ListItem } from "../ListItem"

describe("ListItem", () => {
  it("Scenario: Two-row layout with subtitle, single-row without", () => {
    // With subtitle: subtitle + timestamp on row 1, title on row 2
    const { rerender, container } = render(
      <ListItem title="The Title" subtitle="A subtitle" timestamp="2h" onClick={() => {}} />,
    )
    expect(screen.getByText("A subtitle")).toBeTruthy()
    expect(screen.getByText("The Title")).toBeTruthy()
    expect(screen.getByText("2h")).toBeTruthy()

    // Without subtitle: title + timestamp share row 1, subtitle absent
    rerender(<ListItem title="Solo Title" timestamp="5m" onClick={() => {}} />)
    expect(screen.queryByText("A subtitle")).toBeNull()
    expect(screen.getByText("Solo Title")).toBeTruthy()
    expect(container.textContent).toContain("5m")
  })

  it("Scenario: Selected styling overrides badge colors", () => {
    render(
      <ListItem
        title="Sel"
        timestamp="1m"
        isSelected
        badges={[{ label: "Open", className: "bg-green-500 text-white" }]}
        onClick={() => {}}
      />,
    )
    const button = screen.getByRole("button")
    expect(button.className).toContain("bg-primary")
    expect(button.className).toContain("text-primary-foreground")
    const badge = screen.getByText("Open")
    // selected forces the primary-foreground badge override classes
    expect(badge.className).toContain("!bg-primary-foreground/20")
    expect(badge.className).toContain("!text-primary-foreground")
  })

  it("Scenario: Custom memo comparator skips `onClick` and `icon`", () => {
    // The comparator excludes onClick AND icon from equality. So changing only
    // those props while keeping title/subtitle/timestamp/isSelected/badges equal
    // must NOT re-render — the previously-rendered output (with no icon) persists.
    const { rerender, container } = render(
      <ListItem
        title="Stable"
        subtitle="Same"
        timestamp="1m"
        badges={[{ label: "B" }]}
        onClick={() => {}}
      />,
    )
    // No icon rendered initially
    expect(screen.queryByTestId("the-icon")).toBeNull()

    // Re-render with a NEW onClick closure AND a new icon. Since the comparator
    // ignores both, ListItem skips re-render and the icon never appears.
    rerender(
      <ListItem
        title="Stable"
        subtitle="Same"
        timestamp="1m"
        badges={[{ label: "B" }]}
        icon={<span data-testid="the-icon">ICON</span>}
        onClick={() => "different closure"}
      />,
    )
    expect(screen.queryByTestId("the-icon")).toBeNull()
    expect(container.textContent).toContain("Stable")

    // Sanity: changing a COMPARED prop (title) DOES re-render
    rerender(
      <ListItem
        title="Changed"
        subtitle="Same"
        timestamp="1m"
        badges={[{ label: "B" }]}
        onClick={() => {}}
      />,
    )
    expect(screen.getByText("Changed")).toBeTruthy()
  })
})
