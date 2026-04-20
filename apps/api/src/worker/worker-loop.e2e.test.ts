// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Integration test — worker loop with BullMQ (zero mocks where possible).
 *
 * Requires:
 * - PLOYDOK_TEST_PG_URL: Postgres URL for job history tables
 * - PLOYDOK_TEST_REDIS_URL: Redis URL for BullMQ queues
 *
 * Both are skipped if the respective URL is absent.
 *
 * Strategy for PLOYDOK_BUILD_DIR: leave the default (~/.ploydok-dev/builds).
 * cleanupBuild uses `rm({ recursive: true, force: true })`, so it never
 * errors even when the directory does not exist.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "bun:test"
import { eq } from "drizzle-orm"
import { jobs, job_runs } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { enqueueJob } from "@ploydok/db/queries"
import { makeTestDb, TEST_PG_URL } from "../test/db-helpers"

const skip = !TEST_PG_URL
if (skip) console.log("[worker-loop.e2e.test] PLOYDOK_TEST_PG_URL not set — skipping")

// ---------------------------------------------------------------------------
// Polling helper
// ---------------------------------------------------------------------------

async function pollUntil<T>(
  fn: () => Promise<T | undefined>,
  predicate: (v: T | undefined) => boolean,
  timeoutMs: number,
  intervalMs = 50,
): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const v = await fn()
    if (predicate(v)) return v
    await new Promise<void>((r) => setTimeout(r, intervalMs))
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Tests — jobs table (legacy polling, still works against Postgres)
// ---------------------------------------------------------------------------

describe.skipIf(skip)("worker loop — jobs table (Postgres)", () => {
  let db: Db

  beforeEach(async () => {
    const result = await makeTestDb()
    db = result.db
  })

  it("enqueueJob inserts a pending job", async () => {
    const job = await enqueueJob(db, {
      type: "cleanup.build",
      payload: { appId: "app-wl-1", buildId: "build-wl-1" },
    })

    expect(job.status).toBe("pending")
    expect(job.type).toBe("cleanup.build")

    const rows = await db.select().from(jobs).where(eq(jobs.id, job.id)).limit(1)
    expect(rows[0]?.status).toBe("pending")
  })

  it("enqueueJob with maxAttempts=1 stores max_attempts correctly", async () => {
    const job = await enqueueJob(db, {
      type: "deploy.requested",
      payload: { appId: "app-wl-2" },
      maxAttempts: 1,
    })

    expect(job.max_attempts).toBe(1)
  })
})
