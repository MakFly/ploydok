// SPDX-License-Identifier: AGPL-3.0-only
//
// End-to-end gate proof for the queue-trust pattern (sprint 6bis).
//
// What this test enforces:
//
//   1. The migration `0028_queue_trust.sql` is applied on the test DB —
//      a fresh `INSERT INTO builds (..., queued_at, source)` succeeds.
//   2. `claimQueuedRow` against a row in `pending` status flips it to
//      `running` atomically and returns the updated row.
//   3. A second `claimQueuedRow` call on the same row returns `null`
//      (replay protection — the row is no longer in an expected state).
//   4. `claimQueuedRow` on a non-existent id (the canonical "raw push to
//      Redis without prior API auth" attack) returns `null` ⇒ caller
//      drops the job.
//
// Skipped when `PLOYDOK_TEST_PG_URL` is unset, mirroring the convention
// of `auth.e2e.test.ts`. Migrations run once per process via `makeTestDb`.

import { describe, expect, it } from "bun:test"
import { eq } from "drizzle-orm"
import { nanoid } from "nanoid"
import { apps, builds, projects, users } from "@ploydok/db"
import { makeTestDb, TEST_PG_URL } from "../test/db-helpers"
import { claimQueuedRow } from "./queue-claim"

const skip = !TEST_PG_URL
if (skip) {
  console.log("[queue-trust.e2e] PLOYDOK_TEST_PG_URL not set — skipping")
}

describe.skipIf(skip)("queue-trust e2e — DB-anchored gate", () => {
  it("applies CAS once and drops both replays + raw pushes", async () => {
    const { db, cleanup } = await makeTestDb()
    try {
      const userId = `u_${nanoid(10)}`
      const projectId = `p_${nanoid(10)}`
      const appId = `a_${nanoid(10)}`
      const buildId = `b_${nanoid(10)}`

      // Seed FK chain: user → project → app → build (matches what the API does).
      await db.insert(users).values({
        id: userId,
        email: `qt-${nanoid(8).toLowerCase()}@test.local`,
        display_name: "qt user",
        created_at: new Date(),
        updated_at: new Date(),
      })
      await db.insert(projects).values({
        id: projectId,
        name: "qt-test",
        slug: `qt-${nanoid(8).toLowerCase()}`,
        owner_id: userId,
        created_at: new Date(),
      })
      await db.insert(apps).values({
        id: appId,
        project_id: projectId,
        name: "qt-app",
        slug: `qt-app-${nanoid(8).toLowerCase()}`,
        created_at: new Date(),
        updated_at: new Date(),
      })
      await db.insert(builds).values({
        id: buildId,
        app_id: appId,
        // status defaults to 'pending', source to 'api', queued_at to NOW().
        requested_by_user_id: userId,
      })

      // First claim: pending → running.
      const claimed = await claimQueuedRow<typeof builds.$inferSelect>({
        db,
        table: builds,
        id: buildId,
      })
      expect(claimed).not.toBeNull()
      expect(claimed!.status).toBe("running")
      expect(claimed!.claimed_at).toBeInstanceOf(Date)
      expect(claimed!.requested_by_user_id).toBe(userId)
      expect(claimed!.source).toBe("api")

      // Replay protection: the same buildId is no longer in 'pending'.
      const replay = await claimQueuedRow({ db, table: builds, id: buildId })
      expect(replay).toBeNull()

      // Raw push attack: a buildId that was never written by the API.
      const rogue = await claimQueuedRow({
        db,
        table: builds,
        id: `rogue_${nanoid(10)}`,
      })
      expect(rogue).toBeNull()

      // Cleanup the rows so the test is idempotent. Order matters: child →
      // parent. users deletion cascades to projects via FK ON DELETE CASCADE,
      // so we delete builds + apps explicitly first then drop the user.
      await db.delete(builds).where(eq(builds.id, buildId))
      await db.delete(apps).where(eq(apps.id, appId))
      await db.delete(projects).where(eq(projects.id, projectId))
      await db.delete(users).where(eq(users.id, userId))
    } finally {
      await cleanup()
    }
  }, 30_000)
})
