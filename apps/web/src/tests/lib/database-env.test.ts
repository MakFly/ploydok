// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "bun:test"
import {
  DEFAULT_DATABASE_ENV_PREFIX,
  databaseEnvImportOmittedKeys,
  databaseEnvKeys,
} from "../../lib/database-env"

describe("database env helpers", () => {
  it("uses DATABASE as the global default prefix", () => {
    expect(DEFAULT_DATABASE_ENV_PREFIX).toBe("DATABASE")
    expect(databaseEnvKeys("", "postgres")[0]).toBe("DATABASE_URL")
  })

  it("generates the DB-link managed SQL keys for the selected prefix", () => {
    expect(databaseEnvKeys("DATABASE", "postgres")).toEqual([
      "DATABASE_URL",
      "DATABASE_HOST",
      "DATABASE_PORT",
      "DATABASE_USER",
      "DATABASE_PASSWORD",
      "DATABASE_NAME",
    ])
  })

  it("does not show user/name placeholders for Redis links", () => {
    expect(databaseEnvKeys("REDIS", "redis")).toEqual([
      "REDIS_URL",
      "REDIS_HOST",
      "REDIS_PORT",
      "REDIS_PASSWORD",
    ])
  })

  it("omits imported SQL connection aliases when a database link owns them", () => {
    const omitted = databaseEnvImportOmittedKeys("DATABASE", "postgres")

    expect(omitted.has("DATABASE_URL")).toBe(true)
    expect(omitted.has("DB_URL")).toBe(true)
    expect(omitted.has("DB_DATABASE")).toBe(true)
    expect(omitted.has("PGHOST")).toBe(true)
    expect(omitted.has("APP_ENV")).toBe(false)
  })
})
