// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, mock, spyOn } from "bun:test"
import type { Queue } from "bullmq"
import type { Db } from "@ploydok/db"
import * as queueAudit from "./queue-audit"
import { enqueueWithDbRow } from "./queue-enqueue"

describe("enqueueWithDbRow", () => {
  it("returns jobId and row on success", async () => {
    const fakeRow = { id: "row-123", name: "test-row" }

    const mockDb = {
      transaction: mock(async (callback) => {
        const mockTx = {}
        await callback(mockTx as Db)
      }),
    } as unknown as Db

    const mockQueue = {
      add: mock(async () => ({
        id: "job-456",
        payload: { foo: "bar" },
      })),
    } as unknown as Queue

    const result = await enqueueWithDbRow({
      db: mockDb,
      queue: mockQueue,
      jobName: "test.job",
      insertRow: mock(async () => fakeRow),
      buildPayload: (row) => ({ rowId: row.id }),
    })

    expect(result.jobId).toBe("job-456")
    expect(result.row).toEqual(fakeRow)
  })

  it("rolls back transaction if queue.add throws", async () => {
    const mockDb = {
      transaction: mock(async (callback) => {
        const mockTx = {}
        try {
          await callback(mockTx as Db)
        } catch (e) {
          throw e
        }
      }),
    } as unknown as Db

    const mockQueue = {
      add: mock(async () => {
        throw new Error("Queue add failed")
      }),
    } as unknown as Queue

    const insertRowMock = mock(async () => ({
      id: "row-123",
      name: "test-row",
    }))

    await expect(
      enqueueWithDbRow({
        db: mockDb,
        queue: mockQueue,
        jobName: "test.job",
        insertRow: insertRowMock,
        buildPayload: (row) => ({ rowId: row.id }),
      })
    ).rejects.toThrow("Queue add failed")
  })

  it("throws if job.id is undefined", async () => {
    const mockDb = {
      transaction: mock(async (callback) => {
        const mockTx = {}
        await callback(mockTx as Db)
      }),
    } as unknown as Db

    const mockQueue = {
      add: mock(async () => ({
        id: undefined,
      })),
    } as unknown as Queue

    await expect(
      enqueueWithDbRow({
        db: mockDb,
        queue: mockQueue,
        jobName: "test.job",
        insertRow: mock(async () => ({ id: "row-123" })),
        buildPayload: () => ({}),
      })
    ).rejects.toThrow(/Failed to get job ID/)
  })

  it("handles rows with requested_by_user_id and source fields", async () => {
    const fakeRow = {
      id: "row-123",
      requested_by_user_id: "user-456",
      source: "github",
    }

    const mockDb = {
      transaction: mock(async (callback) => {
        const mockTx = {}
        await callback(mockTx as Db)
      }),
    } as unknown as Db

    const mockQueue = {
      add: mock(async () => ({
        id: "job-789",
      })),
    } as unknown as Queue

    const result = await enqueueWithDbRow({
      db: mockDb,
      queue: mockQueue,
      jobName: "test.job",
      insertRow: mock(async () => fakeRow),
      buildPayload: (row) => ({ rowId: row.id }),
    })

    expect(result.jobId).toBe("job-789")
    expect(result.row).toEqual(fakeRow)
  })

  it("emits enqueue audit payload with actor and source inferred from row", async () => {
    const auditSpy = spyOn(queueAudit, "auditEnqueued")

    const fakeRow = {
      id: "row-123",
      requested_by_user_id: "user-456",
      source: "github",
    }

    const mockDb = {
      transaction: mock(async (callback) => {
        const mockTx = {}
        await callback(mockTx as Db)
      }),
    } as unknown as Db

    const mockQueue = {
      add: mock(async () => ({
        id: "job-456",
      })),
    } as unknown as Queue

    await enqueueWithDbRow({
      db: mockDb,
      queue: mockQueue,
      jobName: "test.job",
      insertRow: mock(async () => fakeRow),
      buildPayload: (row) => ({ rowId: row.id }),
    })

    const [lastCall] = auditSpy.mock.calls.at(-1)! as [
      {
        jobName: string
        jobId: string
        rowId: string
        actor: string | null
        source: string
      },
    ]
    expect(auditSpy).toHaveBeenCalled()
    expect(lastCall).toMatchObject({
      jobName: "test.job",
      jobId: "job-456",
      rowId: "row-123",
      actor: "user-456",
      source: "github",
    })
  })

  it("emits enqueue audit payload with defaults when metadata is absent", async () => {
    const auditSpy = spyOn(queueAudit, "auditEnqueued")

    const fakeRow = { id: "row-123" }

    const mockDb = {
      transaction: mock(async (callback) => {
        const mockTx = {}
        await callback(mockTx as Db)
      }),
    } as unknown as Db

    const mockQueue = {
      add: mock(async () => ({
        id: "job-456",
      })),
    } as unknown as Queue

    await enqueueWithDbRow({
      db: mockDb,
      queue: mockQueue,
      jobName: "test.job",
      insertRow: mock(async () => fakeRow),
      buildPayload: (row) => ({ rowId: row.id }),
    })

    const [lastCall] = auditSpy.mock.calls.at(-1)! as [
      {
        jobName: string
        jobId: string
        rowId: string
        actor: string | null
        source: string
      },
    ]
    expect(auditSpy).toHaveBeenCalled()
    expect(lastCall).toMatchObject({
      jobName: "test.job",
      jobId: "job-456",
      rowId: "row-123",
      actor: null,
      source: "system",
    })
  })

  it("respects jobOptions", async () => {
    const fakeRow = { id: "row-123" }
    const jobOptions = {
      attempts: 5,
      backoff: { type: "exponential" as const, delay: 1000 },
    }

    const addMock = mock(async () => ({ id: "job-456" }))

    const mockDb = {
      transaction: mock(async (callback) => {
        const mockTx = {}
        await callback(mockTx as Db)
      }),
    } as unknown as Db

    const mockQueue = {
      add: addMock,
    } as unknown as Queue

    await enqueueWithDbRow({
      db: mockDb,
      queue: mockQueue,
      jobName: "test.job",
      insertRow: mock(async () => fakeRow),
      buildPayload: (row) => ({ rowId: row.id }),
      jobOptions,
    })

    expect(addMock).toHaveBeenCalledWith(
      "test.job",
      { rowId: "row-123" },
      jobOptions
    )
  })
})
