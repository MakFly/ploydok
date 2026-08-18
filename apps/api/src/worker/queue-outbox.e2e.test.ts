// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, mock } from "bun:test"
import { Queue, QueueEvents, Worker } from "bullmq"
import { and, eq, isNotNull } from "drizzle-orm"
import { nanoid } from "nanoid"
import { createRedis, queue_outbox_events, system_jobs } from "@ploydok/db"
import { makeTestDb, TEST_PG_URL } from "../test/db-helpers"
import { enqueueWithDbRow } from "./queue-enqueue"
import { dispatchQueueOutboxEventById } from "./queue-outbox-dispatcher"
import { claimQueuedRow } from "./queue-claim"

const TEST_REDIS_URL = Bun.env["PLOYDOK_TEST_REDIS_URL"]
const skip = !TEST_PG_URL || !TEST_REDIS_URL
if (skip) {
  console.log(
    "[queue-outbox.e2e] PLOYDOK_TEST_PG_URL or PLOYDOK_TEST_REDIS_URL not set — skipping"
  )
}

describe.skipIf(skip)("JOB-01 transactional queue outbox", () => {
  it("rolls back the business row when its durable event cannot be created", async () => {
    const { db, cleanup } = await makeTestDb()
    const rowId = `qo_rollback_${nanoid(10)}`
    try {
      await expect(
        enqueueWithDbRow({
          db,
          queue: {
            name: "gc.registry",
            add: mock(async () => ({ id: "unused" })) as any,
          },
          jobName: "gc.registry.requested",
          insertRow: (tx) =>
            tx
              .insert(system_jobs)
              .values({
                id: rowId,
                kind: "gc.registry",
                source: "system",
                options: {},
              })
              .returning()
              .then((rows: (typeof system_jobs.$inferSelect)[]) => rows[0]!),
          buildPayload: () => ({ accessToken: "must-not-hit-jsonb" }),
        })
      ).rejects.toThrow(/must contain only jobId/)

      const rows = await db
        .select({ id: system_jobs.id })
        .from(system_jobs)
        .where(eq(system_jobs.id, rowId))
      expect(rows).toHaveLength(0)
    } finally {
      await db
        .delete(queue_outbox_events)
        .where(eq(queue_outbox_events.source_row_id, rowId))
      await db.delete(system_jobs).where(eq(system_jobs.id, rowId))
      await cleanup()
    }
  }, 30_000)

  it("replays after crash/Redis boundary and executes the side effect once", async () => {
    const { db, cleanup } = await makeTestDb()
    const connection = createRedis(TEST_REDIS_URL!)
    const prefix = `qo-e2e-${nanoid(8)}`
    const queue = new Queue("gc.registry", { connection, prefix })
    const events = new QueueEvents("gc.registry", { connection, prefix })
    let sideEffects = 0
    const worker = new Worker(
      "gc.registry",
      async (job) => {
        const payload = job.data as { jobId: string }
        const claimed = await claimQueuedRow({
          db,
          table: system_jobs,
          id: payload.jobId,
        })
        if (claimed) sideEffects += 1
      },
      { connection, prefix, concurrency: 1 }
    )
    const rowId = `qo_replay_${nanoid(10)}`
    let outboxId = ""
    try {
      await Promise.all([
        queue.waitUntilReady(),
        events.waitUntilReady(),
        worker.waitUntilReady(),
      ])
      const accepted = await enqueueWithDbRow({
        db,
        queue,
        jobName: "gc.registry.requested",
        insertRow: (tx) =>
          tx
            .insert(system_jobs)
            .values({
              id: rowId,
              kind: "gc.registry",
              source: "system",
              options: {},
            })
            .returning()
            .then((rows: (typeof system_jobs.$inferSelect)[]) => rows[0]!),
        buildPayload: (row) => ({ jobId: row.id }),
        // Simulate process death after PostgreSQL commit and before Redis.
        dispatchAfterCommit: mock(async () => "idle" as const),
      })
      outboxId = `queue:${queue.name}:${accepted.jobId}`

      const completed = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("BullMQ completion timeout")),
          10_000
        )
        events.on("completed", ({ jobId }) => {
          if (jobId === accepted.jobId) {
            clearTimeout(timeout)
            resolve()
          }
        })
      })

      // Publish succeeds, then the process dies before recording dispatched_at.
      expect(
        await dispatchQueueOutboxEventById(db, queue, outboxId, new Date(), {
          complete: mock(async () => false),
        })
      ).toBe("lease-lost")
      await completed

      // Expired lease is reclaimed on restart. BullMQ sees the same jobId and
      // returns the existing completed job instead of executing it again.
      await db
        .update(queue_outbox_events)
        .set({ lease_until: new Date(0) })
        .where(eq(queue_outbox_events.id, outboxId))
      expect(await dispatchQueueOutboxEventById(db, queue, outboxId)).toBe(
        "dispatched"
      )

      const [stored] = await db
        .select({ dispatchedAt: queue_outbox_events.dispatched_at })
        .from(queue_outbox_events)
        .where(
          and(
            eq(queue_outbox_events.id, outboxId),
            isNotNull(queue_outbox_events.dispatched_at)
          )
        )
      expect(stored?.dispatchedAt).toBeInstanceOf(Date)
      expect(sideEffects).toBe(1)
    } finally {
      await worker.close()
      await events.close()
      await queue.obliterate({ force: true }).catch(() => {})
      await queue.close()
      await connection.quit()
      if (outboxId) {
        await db
          .delete(queue_outbox_events)
          .where(eq(queue_outbox_events.id, outboxId))
      }
      await db.delete(system_jobs).where(eq(system_jobs.id, rowId))
      await cleanup()
    }
  }, 30_000)
})
