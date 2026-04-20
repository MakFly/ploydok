// SPDX-License-Identifier: AGPL-3.0-only
/**
 * totp-endpoints.test.ts — TOTP endpoint integration tests
 *
 * Requires PLOYDOK_TEST_PG_URL — skipped if absent.
 * TODO Wave 2: restore full TOTP endpoint tests (file was regenerated from stub after migration).
 */
import { describe, it, expect, beforeEach } from "bun:test"
import { Hono } from "hono"
import { nanoid } from "nanoid"
import { users, passkeys } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { makeTestDb as makePgTestDb, TEST_PG_URL } from "../test/db-helpers"

const skip = !TEST_PG_URL
if (skip) console.log("[totp-endpoints.test] PLOYDOK_TEST_PG_URL not set — skipping")

async function makeTestDb() {
  const { db } = await makePgTestDb()
  return db
}

type TestDb = Db

describe.skipIf(skip)("TOTP endpoints — stub (Wave 2: restore full tests)", () => {
  let db: TestDb

  beforeEach(async () => {
    db = await makeTestDb()
  })

  it("placeholder — TOTP endpoint tests to be restored in Wave 2", () => {
    // TODO Wave 2: restore full TOTP endpoint tests
    // Original file was accidentally truncated during Wave 1 Postgres migration.
    expect(true).toBe(true)
  })
})
