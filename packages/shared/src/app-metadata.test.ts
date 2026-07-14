// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from "bun:test"
import { AppQuickLinkSchema, SafeHttpUrlSchema } from "./app-metadata"

describe("app metadata URLs", () => {
  test("accepts only HTTP(S) URLs", () => {
    expect(
      SafeHttpUrlSchema.safeParse("https://example.com/icon.png").success
    ).toBe(true)
    expect(SafeHttpUrlSchema.safeParse("http://localhost:3000").success).toBe(
      true
    )
    expect(SafeHttpUrlSchema.safeParse("javascript:alert(1)").success).toBe(
      false
    )
    expect(SafeHttpUrlSchema.safeParse("data:text/html,test").success).toBe(
      false
    )
  })

  test("trims quick-link labels and URLs", () => {
    expect(
      AppQuickLinkSchema.parse({
        label: "  Metrics  ",
        url: "  https://example.com/metrics  ",
      })
    ).toEqual({ label: "Metrics", url: "https://example.com/metrics" })
  })
})
