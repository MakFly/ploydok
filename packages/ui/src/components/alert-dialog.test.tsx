// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tests for AlertDialogAction. Guards the inverted nesting: the primitive
 * holds the slot, the Button renders, so a confirm button can actually show
 * a spinner. AlertDialogCancel shares the same shape but refuses to render
 * outside AlertDialogContent, which never mounts under happy-dom, so it is
 * covered by type-checking and manual verification only.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator"

import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "bun:test"
import * as React from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogFooter,
} from "./alert-dialog"

// Bun runs every file of the package in one process, so registration has to be
// idempotent across test files.
if (typeof globalThis.document === "undefined") {
  GlobalRegistrator.register()
}

afterEach(() => {
  cleanup()
})

// The dialog Content renders through a portal that happy-dom does not mount,
// so the buttons are exercised inside the Root context only.
function renderDialog(node: React.ReactNode): ReturnType<typeof render> {
  return render(
    <AlertDialog open>
      <AlertDialogFooter>{node}</AlertDialogFooter>
    </AlertDialog>
  )
}

describe("AlertDialogAction", () => {
  it("renders a spinner and disables while loading", () => {
    const { getByText } = renderDialog(
      <AlertDialogAction loading>Delete app</AlertDialogAction>
    )
    const button = getByText("Delete app").closest("button")

    expect(button).not.toBeNull()
    expect(button?.disabled).toBe(true)
    expect(button?.getAttribute("aria-busy")).toBe("true")
    expect(button?.querySelector("[data-slot='button-spinner']")).not.toBeNull()
  })

  it("stays clickable and spinner-free when idle", () => {
    const { getByText } = renderDialog(
      <AlertDialogAction>Delete app</AlertDialogAction>
    )
    const button = getByText("Delete app").closest("button")

    expect(button?.disabled).toBe(false)
    expect(button?.querySelector("[data-slot='button-spinner']")).toBeNull()
    expect(button?.getAttribute("data-slot")).toBe("alert-dialog-action")
  })

  it("keeps the variant applied to the rendered button", () => {
    const { getByText } = renderDialog(
      <AlertDialogAction variant="destructive">Delete</AlertDialogAction>
    )

    expect(
      getByText("Delete").closest("button")?.getAttribute("data-variant")
    ).toBe("destructive")
  })
})
