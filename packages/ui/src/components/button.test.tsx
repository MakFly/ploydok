// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tests for the Button loading state.
 * Uses @happy-dom/global-registrator to bootstrap DOM before @testing-library
 * imports are evaluated, avoiding the "global document" timing issue.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator"

import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "bun:test"
import * as React from "react"
import { Button } from "./button"

// Bun runs every file of the package in one process, so registration has to be
// idempotent across test files.
if (typeof globalThis.document === "undefined") {
  GlobalRegistrator.register()
}

afterEach(() => {
  cleanup()
})

describe("Button loading", () => {
  it("renders a spinner, disables and marks the button busy", () => {
    const { getByRole } = render(<Button loading>Save</Button>)
    const button = getByRole("button") as HTMLButtonElement

    expect(button.disabled).toBe(true)
    expect(button.getAttribute("aria-busy")).toBe("true")
    expect(button.querySelector("[data-slot='button-spinner']")).not.toBeNull()
  })

  it("swallows clicks while loading", () => {
    let clicks = 0
    const { getByRole } = render(
      <Button loading onClick={() => (clicks += 1)}>
        Save
      </Button>
    )

    fireEvent.click(getByRole("button"))
    expect(clicks).toBe(0)
  })

  it("stays interactive and spinner-free when idle", () => {
    let clicks = 0
    const { getByRole } = render(
      <Button onClick={() => (clicks += 1)}>Save</Button>
    )
    const button = getByRole("button") as HTMLButtonElement

    expect(button.disabled).toBe(false)
    expect(button.getAttribute("aria-busy")).toBeNull()
    expect(button.querySelector("[data-slot='button-spinner']")).toBeNull()

    fireEvent.click(button)
    expect(clicks).toBe(1)
  })

  it("keeps an explicit disabled prop when not loading", () => {
    const { getByRole } = render(<Button disabled>Save</Button>)
    expect((getByRole("button") as HTMLButtonElement).disabled).toBe(true)
  })

  it("does not inject a spinner into an asChild slot", () => {
    const { getByRole } = render(
      <Button asChild loading>
        <a href="/somewhere">Go</a>
      </Button>
    )
    const link = getByRole("link")

    expect(link.querySelector("[data-slot='button-spinner']")).toBeNull()
    expect(link.textContent).toBe("Go")
  })
})
