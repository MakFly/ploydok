// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tests for DataTable pagination.
 * Uses @happy-dom/global-registrator to bootstrap DOM before @testing-library
 * imports are evaluated, avoiding the "global document" timing issue.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register()

import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "bun:test"
import * as React from "react"
import type { ColumnDef } from "@tanstack/react-table"

import { DataTable } from "./data-table"

afterEach(() => {
  cleanup()
})

interface Row {
  id: number
  label: string
}

const columns: Array<ColumnDef<Row>> = [
  {
    id: "id",
    accessorKey: "id",
    header: "ID",
  },
  {
    id: "label",
    accessorKey: "label",
    header: "Label",
  },
]

const rows: Array<Row> = Array.from({ length: 12 }, (_, i) => ({
  id: i + 1,
  label: `Row ${i + 1}`,
}))

describe("DataTable pagination", () => {
  it("renders 5 rows on page 1 out of 3 pages", () => {
    const { getByText, queryByText } = render(
      <DataTable columns={columns} rows={rows} pageSize={5} />
    )

    expect(getByText("Row 1")).toBeTruthy()
    expect(getByText("Row 5")).toBeTruthy()
    expect(queryByText("Row 6")).toBeNull()
    expect(getByText("Page 1 / 3")).toBeTruthy()
  })

  it("navigates to page 2 on Next click showing rows 6-10", () => {
    const { getByText, queryByText, getByRole } = render(
      <DataTable columns={columns} rows={rows} pageSize={5} />
    )

    fireEvent.click(getByRole("button", { name: /next/i }))

    expect(queryByText("Row 1")).toBeNull()
    expect(getByText("Row 6")).toBeTruthy()
    expect(getByText("Row 10")).toBeTruthy()
    expect(queryByText("Row 11")).toBeNull()
    expect(getByText("Page 2 / 3")).toBeTruthy()
  })

  it("navigates to page 3 showing rows 11-12", () => {
    const { getByText, queryByText, getByRole } = render(
      <DataTable columns={columns} rows={rows} pageSize={5} />
    )

    const nextButton = getByRole("button", { name: /next/i })
    fireEvent.click(nextButton)
    fireEvent.click(nextButton)

    expect(queryByText("Row 10")).toBeNull()
    expect(getByText("Row 11")).toBeTruthy()
    expect(getByText("Row 12")).toBeTruthy()
    expect(getByText("Page 3 / 3")).toBeTruthy()
  })

  it("disables Next button on last page", () => {
    const { getByRole } = render(
      <DataTable columns={columns} rows={rows} pageSize={5} />
    )

    const nextButton = getByRole("button", { name: /next/i })
    fireEvent.click(nextButton)
    fireEvent.click(nextButton)

    expect(nextButton.hasAttribute("disabled")).toBe(true)
  })

  it("disables Prev button on first page", () => {
    const { getByRole } = render(
      <DataTable columns={columns} rows={rows} pageSize={5} />
    )

    const prevButton = getByRole("button", { name: /prev/i })
    expect(prevButton.hasAttribute("disabled")).toBe(true)
  })
})
