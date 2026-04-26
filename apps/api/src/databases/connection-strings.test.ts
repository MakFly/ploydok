// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "bun:test"
import {
  normalizeLinkedDatabaseConnectionString,
  normalizePostgresConnectionString,
} from "./connection-strings"

describe("normalizePostgresConnectionString", () => {
  it("adds Doctrine-compatible Postgres defaults", () => {
    const result = normalizePostgresConnectionString(
      "postgres://user:pass@db:5432/app"
    )

    expect(result).toBe(
      "postgres://user:pass@db:5432/app?serverVersion=16&charset=utf8"
    )
  })

  it("preserves existing query parameters and explicit overrides", () => {
    const result = normalizePostgresConnectionString(
      "postgres://user:pass@db:5432/app?sslmode=require&serverVersion=15"
    )

    expect(result).toBe(
      "postgres://user:pass@db:5432/app?sslmode=require&serverVersion=15&charset=utf8"
    )
  })
})

describe("normalizeLinkedDatabaseConnectionString", () => {
  it("normalizes linked Postgres URLs", () => {
    expect(
      normalizeLinkedDatabaseConnectionString("postgres://u:p@db:5432/app")
    ).toBe("postgres://u:p@db:5432/app?serverVersion=16&charset=utf8")
  })

  it("leaves non-Postgres and invalid values unchanged", () => {
    expect(
      normalizeLinkedDatabaseConnectionString("mysql://u:p@db:3306/app")
    ).toBe("mysql://u:p@db:3306/app")
    expect(normalizeLinkedDatabaseConnectionString("not a url")).toBe(
      "not a url"
    )
  })
})
