// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "bun:test"
import { isAllowedNestedProviderFilePath } from "./provider-file-path"

const allowed = ["package.json", "astro.config.mjs", ".env"]

describe("isAllowedNestedProviderFilePath", () => {
  it("allows an allow-listed file at the root or below a safe rootDir", () => {
    expect(isAllowedNestedProviderFilePath("package.json", allowed)).toBe(true)
    expect(
      isAllowedNestedProviderFilePath("apps/blog/astro.config.mjs", allowed)
    ).toBe(true)
    expect(isAllowedNestedProviderFilePath("apps/blog/.env", allowed)).toBe(true)
  })

  it("rejects traversal, absolute paths, backslashes and unknown basenames", () => {
    for (const path of [
      "../package.json",
      "apps/../package.json",
      "/package.json",
      "apps\\blog\\package.json",
      "apps/blog/secrets.txt",
    ]) {
      expect(isAllowedNestedProviderFilePath(path, allowed)).toBe(false)
    }
  })
})
