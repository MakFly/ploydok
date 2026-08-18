// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "bun:test"
import { findPlaceholderTests } from "./check-test-placeholders"

describe("check-test-placeholders", () => {
  it("finds no tautological assertions in checked-in tests", async () => {
    expect(await findPlaceholderTests()).toEqual([])
  })
})
