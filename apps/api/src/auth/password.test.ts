// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from "bun:test"
import {
  hashPassword,
  validateAdminPassword,
  verifyPassword,
} from "./password"

describe("admin password helpers", () => {
  test("validates length and bcrypt byte limit", () => {
    expect(validateAdminPassword("short")).toContain("at least")
    expect(validateAdminPassword("a".repeat(73))).toContain("at most")
    expect(validateAdminPassword("correct horse battery")).toBeNull()
  })

  test("hashes and verifies passwords", async () => {
    const hash = await hashPassword("correct horse battery")
    expect(hash).not.toBe("correct horse battery")
    expect(await verifyPassword("correct horse battery", hash)).toBe(true)
    expect(await verifyPassword("wrong horse battery", hash)).toBe(false)
  })
})
