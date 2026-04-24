// SPDX-License-Identifier: AGPL-3.0-only
/**
 * audit.test.ts — audit queries against Postgres
 *
 * Requires PLOYDOK_TEST_PG_URL — skipped if absent.
 */
import { beforeAll, afterAll, describe, expect, it } from "bun:test"
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { join } from "node:path"
import { nanoid } from "nanoid"
import { createDb } from "../client"
import { users, audit_log } from "../schema"
import { listAuditEventsForOrg, listAuditEventsForUser } from "./audit"

const PG_URL = Bun.env["PLOYDOK_TEST_PG_URL"]
const MIGRATIONS_DIR = join(import.meta.dir, "../../migrations")

const skip = !PG_URL
if (skip) {
  console.log(
    "[audit.test] PLOYDOK_TEST_PG_URL not set — skipping Postgres tests"
  )
}

describe.skipIf(skip)("audit queries", () => {
  const db = createDb(PG_URL!)
  let sql: ReturnType<typeof postgres>

  let userId1: string
  let userId2: string
  let orgId1: string

  beforeAll(async () => {
    sql = postgres(PG_URL!, { max: 1 })
    const migDb = drizzle(sql)
    await migrate(migDb, { migrationsFolder: MIGRATIONS_DIR })

    const now = new Date()
    userId1 = `audit-user-${nanoid(6)}`
    userId2 = `audit-user-${nanoid(6)}`
    orgId1 = `audit-org-${nanoid(6)}`

    // Create test users
    await db.insert(users).values([
      {
        id: userId1,
        email: `${userId1}@test.local`,
        display_name: "User 1",
        created_at: now,
        updated_at: now,
      },
      {
        id: userId2,
        email: `${userId2}@test.local`,
        display_name: "User 2",
        created_at: now,
        updated_at: now,
      },
    ])

    // Create test audit events
    await db.insert(audit_log).values([
      {
        user_id: userId1,
        action: "app.created",
        target_type: "app",
        target_id: "app-1",
        org_id: orgId1,
        created_at: new Date(now.getTime() - 3000),
      },
      {
        user_id: userId1,
        action: "app.updated",
        target_type: "app",
        target_id: "app-1",
        org_id: orgId1,
        created_at: new Date(now.getTime() - 2000),
      },
      {
        user_id: userId2,
        action: "app.deleted",
        target_type: "app",
        target_id: "app-2",
        org_id: orgId1,
        created_at: new Date(now.getTime() - 1000),
      },
    ])
  })

  afterAll(async () => {
    await sql.end()
  })

  it("lists audit events for org with pagination", async () => {
    const { events, nextCursor } = await listAuditEventsForOrg(db, orgId1, {
      limit: 2,
    })
    expect(events).toHaveLength(2)
    expect(nextCursor).not.toBeNull()
  })

  it("filters by actionPrefix", async () => {
    const { events } = await listAuditEventsForOrg(db, orgId1, {
      actionPrefix: "app.created",
    })
    expect(events.some((e) => e.action === "app.created")).toBe(true)
  })

  it("filters by targetType", async () => {
    const { events } = await listAuditEventsForOrg(db, orgId1, {
      targetType: "app",
    })
    expect(events.every((e) => e.target_type === "app")).toBe(true)
  })

  it("lists audit events for user", async () => {
    const { events } = await listAuditEventsForUser(db, userId1)
    expect(events.every((e) => e.user_id === userId1)).toBe(true)
  })
})
