// SPDX-License-Identifier: AGPL-3.0-only
import { GlobalRegistrator } from "@happy-dom/global-registrator"

import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "bun:test"
import * as React from "react"
import { Skeleton } from "./skeleton"

if (typeof globalThis.document === "undefined") {
  GlobalRegistrator.register()
}

afterEach(() => {
  cleanup()
})

describe("Skeleton", () => {
  it("uses the shared surface and stays decorative", () => {
    const { container } = render(<Skeleton className="h-4 w-12" />)
    const skeleton = container.querySelector('[data-slot="skeleton"]')

    expect(skeleton).not.toBeNull()
    expect(skeleton?.className).toContain("skeleton-surface")
    expect(skeleton?.getAttribute("aria-hidden")).toBe("true")
  })
})
