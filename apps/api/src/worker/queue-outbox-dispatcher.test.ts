// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, mock } from "bun:test"
import type { Queue } from "bullmq"
import type { Db, QueueOutboxEventRow } from "@ploydok/db"
import {
  dispatchNextQueueOutboxEvent,
  dispatchQueueOutboxEventById,
} from "./queue-outbox-dispatcher"

const now = new Date("2026-08-18T12:00:00.000Z")

function event(
  overrides: Partial<QueueOutboxEventRow> = {}
): QueueOutboxEventRow {
  return {
    id: "queue:job-1",
    queue_name: "deploy",
    job_name: "deploy.requested",
    job_id: "job-1",
    source_row_id: "build-1",
    actor_user_id: "user-1",
    source: "api",
    payload: { buildId: "build-1" },
    job_options: { attempts: 3 },
    available_at: now,
    lease_token: "lease-1",
    lease_until: new Date(now.getTime() + 30_000),
    attempt_count: 1,
    dispatched_at: null,
    last_error: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  }
}

describe("queue outbox dispatcher", () => {
  it("publishes with the deterministic ID then completes under the lease", async () => {
    const row = event()
    const add = mock(async () => ({ id: row.job_id }))
    const complete = mock(async () => true)
    const audit = mock(() => {})
    const result = await dispatchQueueOutboxEventById(
      {} as Db,
      { name: "deploy", add } as unknown as Queue,
      row.id,
      now,
      {
        claim: mock(async () => ({ event: row, leaseToken: "lease-1" })),
        complete,
        audit,
      }
    )
    expect(result).toBe("dispatched")
    expect(add).toHaveBeenCalledWith(
      "deploy.requested",
      { buildId: "build-1" },
      { attempts: 3, jobId: "job-1" }
    )
    expect(complete).toHaveBeenCalledWith(
      expect.anything(),
      row.id,
      "lease-1",
      now
    )
    expect(audit).toHaveBeenCalledTimes(1)
  })

  it("releases the lease with backoff when Redis is unavailable", async () => {
    const row = event({ attempt_count: 3 })
    const retry = mock(async () => true)
    const result = await dispatchQueueOutboxEventById(
      {} as Db,
      {
        name: "deploy",
        add: mock(async () => {
          throw new Error("redis down")
        }),
      } as unknown as Queue,
      row.id,
      now,
      {
        claim: mock(async () => ({ event: row, leaseToken: "lease-1" })),
        retry,
      }
    )
    expect(result).toBe("retry")
    expect(retry).toHaveBeenCalledWith(
      expect.anything(),
      row.id,
      "lease-1",
      "redis down",
      new Date(now.getTime() + 4_000),
      now
    )
  })

  it("retries instead of hanging forever when Redis does not answer", async () => {
    const row = event()
    const retry = mock(async () => true)
    const result = await dispatchQueueOutboxEventById(
      {} as Db,
      {
        name: "deploy",
        add: mock(() => new Promise(() => {})),
      } as unknown as Queue,
      row.id,
      now,
      {
        claim: mock(async () => ({ event: row, leaseToken: "lease-1" })),
        retry,
        addTimeoutMs: 1,
      }
    )
    expect(result).toBe("retry")
    expect(retry).toHaveBeenCalledWith(
      expect.anything(),
      row.id,
      "lease-1",
      "BullMQ add timed out for deploy",
      new Date(now.getTime() + 1_000),
      now
    )
  })

  it("reconciles a committed event after a simulated process crash", async () => {
    const row = event()
    const add = mock(async () => ({ id: row.job_id }))
    const complete = mock(async () => true)
    const result = await dispatchNextQueueOutboxEvent(
      {} as Db,
      new Map([["deploy", { name: "deploy", add } as unknown as Queue]]),
      now,
      {
        claim: mock(async () => ({ event: row, leaseToken: "restarted" })),
        complete,
      }
    )
    expect(result).toBe("dispatched")
    expect(add).toHaveBeenCalledTimes(1)
    expect(complete).toHaveBeenCalledWith(
      expect.anything(),
      row.id,
      "restarted",
      now
    )
  })

  it("does not acknowledge an event after losing its SQL lease", async () => {
    const row = event()
    const result = await dispatchQueueOutboxEventById(
      {} as Db,
      {
        name: "deploy",
        add: mock(async () => ({ id: row.job_id })),
      } as unknown as Queue,
      row.id,
      now,
      {
        claim: mock(async () => ({ event: row, leaseToken: "stale" })),
        complete: mock(async () => false),
      }
    )
    expect(result).toBe("lease-lost")
  })

  it("defers unknown queues without dropping the event", async () => {
    const row = event({ queue_name: "removed.queue" })
    const retry = mock(async () => true)
    const result = await dispatchNextQueueOutboxEvent(
      {} as Db,
      new Map(),
      now,
      {
        claim: mock(async () => ({ event: row, leaseToken: "lease-1" })),
        retry,
      }
    )
    expect(result).toBe("retry")
    expect(retry).toHaveBeenCalledTimes(1)
  })
})
