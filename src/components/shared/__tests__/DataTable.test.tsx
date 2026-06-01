// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"
import { DataTable } from "../DataTable"

const cols = ["Name", "Age"]
const makeRows = (n: number) => Array.from({ length: n }, (_, i) => [`Person ${i}`, i])

describe("DataTable", () => {
  it("Scenario: Auto-enables search above 5 rows, pagination above 20", () => {
    // <= 5 rows: no search input
    const { rerender } = render(<DataTable columns={cols} rows={makeRows(3)} />)
    expect(screen.queryByPlaceholderText("Filter...")).toBeNull()

    // > 5 rows: search appears
    rerender(<DataTable columns={cols} rows={makeRows(6)} />)
    expect(screen.getByPlaceholderText("Filter...")).toBeTruthy()
    // 6 rows is not > 20 so no pagination footer
    expect(screen.queryByText(/row/)).toBeNull()

    // > 20 rows: pagination footer appears
    rerender(<DataTable columns={cols} rows={makeRows(25)} />)
    expect(screen.getByText("25 rows")).toBeTruthy()

    // explicit prop overrides: searchable=false with many rows hides search
    rerender(<DataTable columns={cols} rows={makeRows(25)} searchable={false} />)
    expect(screen.queryByPlaceholderText("Filter...")).toBeNull()
  })

  it("Scenario: Cells render `null`/`undefined` as a muted em-dash", () => {
    render(<DataTable columns={cols} rows={[["Alice", null], ["Bob", undefined]]} />)
    const dashes = screen.getAllByText("—")
    expect(dashes.length).toBe(2)
    expect(dashes[0].className).toContain("text-muted-foreground")
  })

  it("Scenario: Sortable column headers", () => {
    render(<DataTable columns={cols} rows={[["Charlie", 3], ["Alice", 1], ["Bob", 2]]} />)
    const header = () => screen.getByRole("button", { name: /Name/ })
    // before sort, first data row is Charlie
    const bodyRows = () => screen.getAllByRole("row").slice(1) // drop header row
    expect(within(bodyRows()[0]).getByText("Charlie")).toBeTruthy()
    fireEvent.click(header()) // asc
    expect(within(bodyRows()[0]).getByText("Alice")).toBeTruthy()
    fireEvent.click(header()) // desc
    expect(within(bodyRows()[0]).getByText("Charlie")).toBeTruthy()
  })

  it("Scenario: Empty/no-results state", () => {
    render(<DataTable columns={cols} rows={[]} />)
    expect(screen.getByText("No results")).toBeTruthy()
  })

  it("Scenario: Pagination footer shows count and chevrons", () => {
    render(<DataTable columns={cols} rows={makeRows(45)} pageSize={20} />)
    // count on the left
    expect(screen.getByText("45 rows")).toBeTruthy()
    // page indicator current / total (45 rows / 20 = 3 pages)
    expect(screen.getByText("1 / 3")).toBeTruthy()
    const buttons = screen.getAllByRole("button").filter((b) => b.className.includes("h-7"))
    const [prev, next] = buttons
    // prev disabled on first page, next enabled
    expect((prev as HTMLButtonElement).disabled).toBe(true)
    expect((next as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(next)
    expect(screen.getByText("2 / 3")).toBeTruthy()
  })
})
