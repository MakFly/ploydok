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
import { Queue, QueueEvents, Worker } from "bullmq"
import { eq } from "drizzle-orm"
import { nanoid } from "nanoid"
import { createRedis, apps, builds, projects, system_jobs, users } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { env } from "../env"
import { makeTestDb, TEST_PG_URL } from "../test/db-helpers"
import { claimQueuedRow } from "./queue-claim"
import { GcRegistryOptionsSchema, runRegistryGc } from "./handlers/gc-registry"

const TEST_REDIS_URL = Bun.env["PLOYDOK_TEST_REDIS_URL"] ?? env.REDIS_URL

interface WorkerHarness {
  queue: Queue
  queueEvents: QueueEvents
  close: () => Promise<void>
}

async function createGcRegistryHarness(db: Db): Promise<WorkerHarness> {
  const prefix = `queue-trust-e2e-${nanoid(8)}`
  const connection = createRedis(TEST_REDIS_URL)

  const queue = new Queue("gc.registry", {
    connection,
    prefix,
  })
  const queueEvents = new QueueEvents("gc.registry", {
    connection,
    prefix,
  })
  const worker = new Worker(
    "gc.registry",
    async (job) => {
      const { jobId } = job.data as { jobId?: string }
      if (!jobId) {
        return { dropped: "missing-job-id" }
      }

      const claimed = await claimQueuedRow<typeof system_jobs.$inferSelect>({
        db,
        table: system_jobs,
        id: jobId,
      })
      if (!claimed) {
        return { dropped: "missing-row" }
      }

      const opts = GcRegistryOptionsSchema.parse(claimed.options)
      if (opts.appId) {
        await runRegistryGc({
          db,
          appFilter: opts.appId,
          keepPerRepo: opts.keepPerRepo,
        })
      } else {
        await runRegistryGc({ db, keepPerRepo: opts.keepPerRepo })
      }

      await db
        .update(system_jobs)
        .set({ status: "succeeded", finished_at: new Date() })
        .where(eq(system_jobs.id, jobId))

      return { claimed: true, rowId: jobId }
    },
    {
      connection,
      prefix,
      concurrency: 1,
    }
  )

  await Promise.all([
    queue.waitUntilReady(),
    worker.waitUntilReady(),
    queueEvents.waitUntilReady(),
  ])

  return {
    queue,
    queueEvents,
    close: async () => {
      await worker.close()
      await queueEvents.close()
      await queue.close()
      await connection.quit()
    },
  }
}

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

describe.skipIf(skip)("queue-trust e2e — system_jobs (gc.registry)", () => {
  it("CAS once + drops replays + raw push", async () => {
    const { db, cleanup } = await makeTestDb()
    try {
      const userId = `u_${nanoid(10)}`
      const sysJobId = `sj_${nanoid(10)}`

      // Seed a user (required FK target).
      await db.insert(users).values({
        id: userId,
        email: `qt-sys-${nanoid(8).toLowerCase()}@test.local`,
        display_name: "qt sys",
        created_at: new Date(),
        updated_at: new Date(),
      })

      // Insert a queued system_jobs row.
      await db.insert(system_jobs).values({
        id: sysJobId,
        kind: "gc.registry",
        requested_by_user_id: userId,
        source: "api",
        options: { appId: "test-app", keepPerRepo: 3 },
      })

      // First claim: pending → running.
      const claimed = await claimQueuedRow<typeof system_jobs.$inferSelect>({
        db,
        table: system_jobs,
        id: sysJobId,
      })
      expect(claimed).not.toBeNull()
      expect(claimed!.status).toBe("running")
      expect(claimed!.claimed_at).toBeInstanceOf(Date)
      expect(claimed!.requested_by_user_id).toBe(userId)
      expect(claimed!.source).toBe("api")
      expect((claimed!.options as { appId: string }).appId).toBe("test-app")

      // Replay: same id, no longer pending.
      const replay = await claimQueuedRow({
        db,
        table: system_jobs,
        id: sysJobId,
      })
      expect(replay).toBeNull()

      // Raw push attack: rogue id never written by API.
      const rogue = await claimQueuedRow({
        db,
        table: system_jobs,
        id: `rogue_${nanoid(10)}`,
      })
      expect(rogue).toBeNull()

      // Cleanup.
      await db.delete(system_jobs).where(eq(system_jobs.id, sysJobId))
      await db.delete(users).where(eq(users.id, userId))
    } finally {
      await cleanup()
    }
  }, 30_000)

  it("drops raw gc payload at worker-consumption time", async () => {
    const { db, cleanup } = await makeTestDb()
    const targetJobId = `sj_${nanoid(10)}`
    const workerHarness = await createGcRegistryHarness(db)

    await db.insert(system_jobs).values({
      id: targetJobId,
      kind: "gc.registry",
      options: { appId: null, keepPerRepo: 3 },
      source: "system",
    })

    try {
      const legitJob = await workerHarness.queue.add("gc.registry.requested", {
        jobId: targetJobId,
      })
      await legitJob.waitUntilFinished(workerHarness.queueEvents)

      const [targetBeforeReplay] = await db
        .select({ status: system_jobs.status })
        .from(system_jobs)
        .where(eq(system_jobs.id, targetJobId))
      expect(targetBeforeReplay?.status).toBe("succeeded")

      const raw = await workerHarness.queue.add("gc.registry.requested", {
        appId: "app-raw",
        keepPerRepo: 0,
      })
      const rawResult = await raw.waitUntilFinished(workerHarness.queueEvents)
      expect(rawResult).toMatchObject({ dropped: "missing-job-id" })

      const [targetAfterRaw] = await db
        .select({ status: system_jobs.status })
        .from(system_jobs)
        .where(eq(system_jobs.id, targetJobId))
      expect(targetAfterRaw?.status).toBe("succeeded")
    } finally {
      await workerHarness.close()
      await cleanup()
    }
  }, 30_000)

  it("prevents replay with duplicate jobId in queue", async () => {
    const { db, cleanup } = await makeTestDb()
    const replayJobId = `sj_${nanoid(10)}`
    const workerHarness = await createGcRegistryHarness(db)

    await db.insert(system_jobs).values({
      id: replayJobId,
      kind: "gc.registry",
      options: { appId: null, keepPerRepo: 3 },
      source: "system",
    })

    try {
      const firstAttempt = await workerHarness.queue.add("gc.registry.requested", {
        jobId: replayJobId,
      })
      const firstResult = await firstAttempt.waitUntilFinished(
        workerHarness.queueEvents
      )
      expect(firstResult).toMatchObject({ claimed: true, rowId: replayJobId })

      const secondAttempt = await workerHarness.queue.add(
        "gc.registry.requested",
        {
          jobId: replayJobId,
        }
      )
      const secondResult = await secondAttempt.waitUntilFinished(
        workerHarness.queueEvents
      )
      expect(secondResult).toMatchObject({ dropped: "missing-row" })

      const [target] = await db
        .select({ status: system_jobs.status })
        .from(system_jobs)
        .where(eq(system_jobs.id, replayJobId))
      expect(target?.status).toBe("succeeded")
    } finally {
      await workerHarness.close()
      await cleanup()
    }
  }, 30_000)
})
