// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, mock } from "bun:test"
import type { Queue } from "bullmq"
import type { Db } from "@ploydok/db"
import {
  deterministicQueueJobId,
  durableJsonObject,
  enqueueWithDbRow,
  assertTransactionalQueueRegistry,
  TRANSACTIONAL_QUEUE_CONTRACTS,
  persistQueueOutboxWithDbRow,
} from "./queue-enqueue"

function harness() {
  const calls: string[] = []
  const persisted: Array<Record<string, unknown>> = []
  let active = false
  const tx = {
    insert: mock(() => ({
      values: mock((values: Record<string, unknown>) => ({
        returning: mock(async () => {
          persisted.push(values)
          calls.push("outbox:insert")
          return [{ ...values, created_at: new Date(), updated_at: new Date() }]
        }),
      })),
    })),
  }
  const db = {
    transaction: mock(async (callback: (value: unknown) => unknown) => {
      active = true
      calls.push("tx:start")
      try {
        const value = await callback(tx)
        calls.push("tx:commit")
        return value
      } finally {
        active = false
      }
    }),
  } as unknown as Db
  const queue = { name: "deploy" } as Queue
  const dispatch = mock(async () => {
    calls.push(`dispatch:${active ? "inside" : "after"}`)
    return "dispatched" as const
  })
  return { calls, persisted, db, queue, dispatch }
}

describe("transactional queue enqueue", () => {
  it("commits the business row and durable dispatch intent in one transaction", async () => {
    const h = harness()
    const row = {
      id: "build-1",
      requested_by_user_id: "user-1",
      source: "api",
    }
    const result = await enqueueWithDbRow({
      db: h.db,
      queue: h.queue,
      jobName: "deploy.requested",
      insertRow: mock(async (tx) => {
        expect(tx).toBeDefined()
        h.calls.push("business:insert")
        return row
      }),
      buildPayload: (saved) => ({ buildId: saved.id }),
      jobOptions: { attempts: 3 },
      dispatchAfterCommit: h.dispatch,
    })

    expect(h.calls).toEqual([
      "tx:start",
      "business:insert",
      "outbox:insert",
      "tx:commit",
      "dispatch:after",
    ])
    expect(result).toEqual({
      row,
      jobId: deterministicQueueJobId("deploy", "build-1"),
    })
    expect(h.persisted[0]).toMatchObject({
      queue_name: "deploy",
      job_name: "deploy.requested",
      source_row_id: "build-1",
      actor_user_id: "user-1",
      source: "api",
      payload: { buildId: "build-1" },
      job_options: { attempts: 3 },
    })
  })

  it("persists every app build and outbox intent in one caller-owned transaction", async () => {
    const h = harness()
    const results = await h.db.transaction((tx) =>
      Promise.all(
        ["app-a", "app-b"].map((appId) =>
          persistQueueOutboxWithDbRow({
            db: tx,
            queue: h.queue,
            jobName: "deploy.requested",
            insertRow: async () => ({ id: `build-${appId}`, app_id: appId }),
            buildPayload: (row) => ({ buildId: row.id }),
          })
        )
      )
    )
    expect(h.calls.filter((call) => call === "tx:start")).toHaveLength(1)
    expect(h.calls.filter((call) => call === "tx:commit")).toHaveLength(1)
    expect(results.map((result) => result.row.app_id)).toEqual([
      "app-a",
      "app-b",
    ])
    expect(h.persisted.map((event) => event.payload)).toEqual([
      { buildId: "build-app-a" },
      { buildId: "build-app-b" },
    ])
  })

  it("returns the durable job ID when immediate Redis dispatch fails", async () => {
    const h = harness()
    const result = await enqueueWithDbRow({
      db: h.db,
      queue: h.queue,
      jobName: "deploy.requested",
      insertRow: async () => ({ id: "build-crash" }),
      buildPayload: (row) => ({ buildId: row.id }),
      dispatchAfterCommit: mock(async () => {
        throw new Error("redis unavailable")
      }),
    })
    expect(result.jobId).toBe(deterministicQueueJobId("deploy", "build-crash"))
    expect(h.persisted).toHaveLength(1)
  })

  it("uses stable queue-scoped identifiers", () => {
    expect(deterministicQueueJobId("deploy", "row-1")).toBe(
      deterministicQueueJobId("deploy", "row-1")
    )
    expect(deterministicQueueJobId("deploy", "row-1")).toBe("row-1")
    expect(deterministicQueueJobId("deploy", "row-1")).not.toContain(":")
    expect(() => deterministicQueueJobId("deploy", "bad:id")).toThrow(
      /not BullMQ-safe/
    )
  })

  it("rejects every payload that is not the exact reference contract", async () => {
    const h = harness()
    await expect(
      enqueueWithDbRow({
        db: h.db,
        queue: h.queue,
        jobName: "deploy.requested",
        insertRow: async () => ({ id: "build-sensitive" }),
        buildPayload: () => ({ accessToken: "bearer" }),
        dispatchAfterCommit: h.dispatch,
      })
    ).rejects.toThrow(/must contain only buildId/)

    await expect(
      enqueueWithDbRow({
        db: h.db,
        queue: h.queue,
        jobName: "unknown.job",
        insertRow: async () => ({ id: "build-unknown" }),
        buildPayload: (row) => ({ buildId: row.id }),
        dispatchAfterCommit: h.dispatch,
      })
    ).rejects.toThrow(/no reference payload contract/)
  })

  it("rejects non-object and oversized durable payloads", () => {
    expect(() => durableJsonObject(["row-1"], "payload")).toThrow(
      /must be a JSON object/
    )
    expect(() =>
      durableJsonObject({ value: "x".repeat(70_000) }, "payload")
    ).toThrow(/exceeds 64 KiB/)
  })

  it("never lets caller jobOptions override the deterministic job ID", async () => {
    const h = harness()
    await enqueueWithDbRow({
      db: h.db,
      queue: h.queue,
      jobName: "deploy.requested",
      insertRow: async () => ({ id: "build-2" }),
      buildPayload: (row) => ({ buildId: row.id }),
      jobOptions: { jobId: "attacker-controlled", attempts: 2 },
      dispatchAfterCommit: h.dispatch,
    })
    expect(h.persisted[0]?.job_options).toEqual({ attempts: 2 })
  })

  it("accepts only bounded retry attempts as durable job options", async () => {
    const h = harness()
    await expect(
      enqueueWithDbRow({
        db: h.db,
        queue: h.queue,
        jobName: "deploy.requested",
        insertRow: async () => ({ id: "build-options" }),
        buildPayload: (row) => ({ buildId: row.id }),
        jobOptions: { delay: 1000 },
        dispatchAfterCommit: h.dispatch,
      })
    ).rejects.toThrow(/unsupported keys/)
  })

  it("requires the transactional queue registry to match contracts exhaustively", () => {
    const queues = [
      ...new Set(
        TRANSACTIONAL_QUEUE_CONTRACTS.map((contract) => contract.queueName)
      ),
    ].map((name) => ({ name }))
    expect(() => assertTransactionalQueueRegistry(queues)).not.toThrow()
    expect(() => assertTransactionalQueueRegistry(queues.slice(1))).toThrow(
      /registry mismatch/
    )
    expect(() =>
      assertTransactionalQueueRegistry([...queues, { name: "unregistered" }])
    ).toThrow(/registry mismatch/)
  })
})
