// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "bun:test"
import { parseConnectionString } from "./apps-databases-link"

describe("parseConnectionString", () => {
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
