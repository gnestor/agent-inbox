// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { PanelWidget } from "../PanelWidget"
import type { WidgetDef } from "@/types/panels"

describe("PanelWidget action-buttons", () => {
  it("Scenario: Action buttons map to mutations, not arbitrary handlers — clicking calls onMutate with the action's mutation + payload[payloadField] or the whole data object", () => {
    const onMutate = vi.fn()
    const data = { id: "t-1", labels: ["bug"], summary: "An issue" }
    const widgets: WidgetDef[] = [
      {
        type: "action-buttons",
        actions: [
          { label: "Close Issue", mutation: "close-issue" }, // no payloadField → whole data object
          { label: "Add Label", mutation: "add-label", payloadField: "labels" }, // payload = data.labels
        ],
      },
    ]

    render(<PanelWidget widgets={widgets} data={data} onMutate={onMutate} />)

    fireEvent.click(screen.getByText("Close Issue"))
    expect(onMutate).toHaveBeenCalledWith("close-issue", data)

    fireEvent.click(screen.getByText("Add Label"))
    expect(onMutate).toHaveBeenCalledWith("add-label", ["bug"])
  })
})
