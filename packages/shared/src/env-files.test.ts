// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "bun:test"
import { parseEnvFile } from "./env-files"

describe("parseEnvFile", () => {
  it("parses dotenv keys, quotes, comments, and export prefixes", () => {
    expect(
      parseEnvFile(`
# ignored
APP_ENV=prod
APP_DEBUG=0 # disabled
export DATABASE_URL="postgres://user:pass@db:5432/app"
PRIVATE_KEY='line1\\nline2'
invalid-key=ignored
`)
    ).toEqual([
      { key: "APP_ENV", value: "prod" },
      { key: "APP_DEBUG", value: "0" },
      { key: "DATABASE_URL", value: "postgres://user:pass@db:5432/app" },
      { key: "PRIVATE_KEY", value: "line1\\nline2" },
    ])
  })

  it("keeps the last duplicate value", () => {
    expect(parseEnvFile("APP_ENV=dev\nAPP_ENV=prod")).toEqual([
      { key: "APP_ENV", value: "prod" },
    ])
  })
})
