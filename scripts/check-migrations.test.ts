// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "bun:test"
import { checkMigrations, validateMigrationInventory } from "./check-migrations"

const entry = (idx: number, when: number, tag: string) => ({
  idx,
  version: "7",
  when,
  tag,
  breakpoints: true,
})

describe("check-migrations", () => {
  it("accepts the checked-in migration inventory", async () => {
    const result = await checkMigrations()
    expect(result.entries).toBeGreaterThan(0)
    expect(result.errors).toEqual([])
  })

  it("rejects missing files, orphan files and stale timestamps", () => {
    const errors = validateMigrationInventory(
      [entry(0, 200, "0000_first"), entry(1, 100, "0001_second")],
      ["0000_first", "0002_orphan"],
    )

    expect(errors).toContain("timestamp for 0001_second must be newer than 0000_first")
    expect(errors).toContain("journal entry has no SQL file: 0001_second.sql")
    expect(errors).toContain("SQL migration is missing from journal: 0002_orphan.sql")
  })

  it("rejects tag/index mismatches and duplicate indexes", () => {
    const errors = validateMigrationInventory(
      [entry(0, 100, "0000_first"), entry(0, 200, "0001_second")],
      ["0000_first", "0001_second"],
    )

    expect(errors).toContain("tag 0001_second does not match journal index 0")
    expect(errors).toContain("duplicate journal index 0")
    expect(errors).toContain("journal index 0 is not ordered after 0")
  })
})
