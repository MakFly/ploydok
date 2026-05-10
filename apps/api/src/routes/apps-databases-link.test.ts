// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "bun:test"
import {
  DEFAULT_DATABASE_ENV_PREFIX,
  findLinkedEnvKeyConflicts,
  parseConnectionString,
} from "./apps-databases-link"

describe("parseConnectionString", () => {
  it("defaults database links to DATABASE_URL-compatible prefixes", () => {
    expect(DEFAULT_DATABASE_ENV_PREFIX).toBe("DATABASE")
  })

  it("uses the selected prefix instead of forcing DATABASE_URL", () => {
    const vars = parseConnectionString(
      "postgres",
      "postgres://ploydok:secret@ploydok-db-test:5432/app",
      "DB"
    )

    expect(vars.DB_URL).toBe(
      "postgres://ploydok:secret@ploydok-db-test:5432/app?serverVersion=16&charset=utf8"
    )
    expect(vars.DATABASE_URL).toBeUndefined()
  })

  it("injects Doctrine-compatible defaults for linked Postgres URLs", () => {
    const vars = parseConnectionString(
      "postgres",
      "postgres://ploydok:secret@ploydok-db-test:5432/app",
      "DATABASE"
    )

    expect(vars.DATABASE_URL).toBe(
      "postgres://ploydok:secret@ploydok-db-test:5432/app?serverVersion=16&charset=utf8"
    )
    expect(vars.DATABASE_HOST).toBe("ploydok-db-test")
    expect(vars.DATABASE_PORT).toBe("5432")
    expect(vars.DATABASE_NAME).toBe("app")
  })

  it("does not alter non-Postgres linked URLs", () => {
    const vars = parseConnectionString(
      "mysql",
      "mysql://ploydok:secret@mysql-db:3306/app",
      "DATABASE"
    )

    expect(vars.DATABASE_URL).toBe("mysql://ploydok:secret@mysql-db:3306/app")
  })
})

describe("findLinkedEnvKeyConflicts", () => {
  it("blocks manual env vars and vars linked to another database", () => {
    const conflicts = findLinkedEnvKeyConflicts(
      [
        { key: "DATABASE_URL", linked_database_id: null },
        { key: "DATABASE_HOST", linked_database_id: "other-db" },
        { key: "DATABASE_PORT", linked_database_id: "db-1" },
      ],
      "db-1"
    )

    expect(conflicts).toEqual(["DATABASE_HOST", "DATABASE_URL"])
  })

  it("allows idempotent relinks for the same database", () => {
    const conflicts = findLinkedEnvKeyConflicts(
      [
        { key: "DB_URL", linked_database_id: "db-1" },
        { key: "DB_HOST", linked_database_id: "db-1" },
      ],
      "db-1"
    )

    expect(conflicts).toEqual([])
  })
})
