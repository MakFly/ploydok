// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, mock } from "bun:test"
import type { Db } from "@ploydok/db"
import { claimQueuedRow } from "./queue-claim"

type ClaimTestRow = {
  id: string
  status: "pending" | "running" | "succeeded"
  claimed_at: Date | null
}

function createClaimDbState(initialStatus: "pending" | "running" | "succeeded", id = "row-123") {
  const row: ClaimTestRow = { id, status: initialStatus, claimed_at: null }
  const state = { claimedCount: 0, lastPayload: {} as Record<string, unknown> }

  const mockDb = {
    update: mock(() => ({
      set: mock((payload) => {
        state.lastPayload = payload as Record<string, unknown>
        return {
          where: mock(() => ({
            returning: mock(async () => {
              if (row.status !== "pending") {
                return []
              }
              state.claimedCount += 1
              const claimed = {
                ...row,
                status: "running",
                claimed_at: new Date(),
                ...state.lastPayload,
              }
              row.status = claimed.status as ClaimTestRow["status"]
              row.claimed_at = claimed.claimed_at
              return [claimed]
            }),
          })),
        }
      }),
    })),
  } as unknown as Db

  return { mockDb, state }
}

describe("claimQueuedRow", () => {
  it("returns the updated row on success", async () => {
    const updatedRow = {
      id: "row-123",
      status: "running",
      claimed_at: new Date(),
    }

    const mockDb = {
      update: mock((table) => ({
        set: mock((payload) => ({
          where: mock((condition) => ({
            returning: mock(async () => [updatedRow]),
          })),
        })),
      })),
    } as unknown as Db

    const mockTable = {} as any

    const result = await claimQueuedRow({
      db: mockDb,
      table: mockTable,
      id: "row-123",
    })

    expect(result).toEqual(updatedRow)
  })

  it("returns null when row is not found", async () => {
    const mockDb = {
      update: mock((table) => ({
        set: mock((payload) => ({
          where: mock((condition) => ({
            returning: mock(async () => []),
          })),
        })),
      })),
    } as unknown as Db

    const mockTable = {} as any

    const result = await claimQueuedRow({
      db: mockDb,
      table: mockTable,
      id: "row-not-exists",
    })

    expect(result).toBeNull()
  })

  it("uses default expectedStatuses of ['pending']", async () => {
    let capturedWhereCondition: any = null

    const mockDb = {
      update: mock((table) => ({
        set: mock((payload) => ({
          where: mock((condition) => {
            capturedWhereCondition = condition
            return {
              returning: mock(async () => []),
            }
          }),
        })),
      })),
    } as unknown as Db

    const mockTable = {} as any

    await claimQueuedRow({
      db: mockDb,
      table: mockTable,
      id: "row-123",
    })

    expect(capturedWhereCondition).toBeDefined()
  })

  it("respects custom expectedStatuses", async () => {
    let capturedWhereCondition: any = null

    const mockDb = {
      update: mock((table) => ({
        set: mock((payload) => ({
          where: mock((condition) => {
            capturedWhereCondition = condition
            return {
              returning: mock(async () => []),
            }
          }),
        })),
      })),
    } as unknown as Db

    const mockTable = {} as any

    await claimQueuedRow({
      db: mockDb,
      table: mockTable,
      id: "row-123",
      expectedStatuses: ["pending", "running"],
    })

    expect(capturedWhereCondition).toBeDefined()
  })

  it("sets status to 'running' and claimed_at by default", async () => {
    let capturedPayload: any = null

    const mockDb = {
      update: mock((table) => ({
        set: mock((payload) => {
          capturedPayload = payload
          return {
            where: mock((condition) => ({
              returning: mock(async () => [{ id: "row-123" }]),
            })),
          }
        }),
      })),
    } as unknown as Db

    const mockTable = {} as any

    await claimQueuedRow({
      db: mockDb,
      table: mockTable,
      id: "row-123",
    })

    expect(capturedPayload).toBeDefined()
    expect(capturedPayload.status).toBe("running")
    expect(capturedPayload.claimed_at).toBeDefined()
  })

  it("skips claimed_at when setClaimedAt is false", async () => {
    let capturedPayload: any = null

    const mockDb = {
      update: mock((table) => ({
        set: mock((payload) => {
          capturedPayload = payload
          return {
            where: mock((condition) => ({
              returning: mock(async () => [{ id: "row-123" }]),
            })),
          }
        }),
      })),
    } as unknown as Db

    const mockTable = {} as any

    await claimQueuedRow({
      db: mockDb,
      table: mockTable,
      id: "row-123",
      setClaimedAt: false,
    })

    expect(capturedPayload).toBeDefined()
    expect(capturedPayload.status).toBe("running")
    expect(capturedPayload.claimed_at).toBeUndefined()
  })

  it("claims pending row once (CAS) and rejects replay/double claim", async () => {
    const { mockDb, state } = createClaimDbState("pending")
    const mockTable = {} as any

    const firstClaim = await claimQueuedRow<ClaimTestRow>({
      db: mockDb,
      table: mockTable,
      id: "row-123",
    })

    const secondClaim = await claimQueuedRow<ClaimTestRow>({
      db: mockDb,
      table: mockTable,
      id: "row-123",
    })

    expect(firstClaim).toMatchObject({ id: "row-123", status: "running" })
    expect(firstClaim?.claimed_at).toBeDefined()
    expect(state.claimedCount).toBe(1)
    expect(state.lastPayload.status).toBe("running")
    expect(secondClaim).toBeNull()
  })

  it("returns null for invalid status when row is not claimable", async () => {
    const { mockDb } = createClaimDbState("succeeded")
    const mockTable = {} as any

    const result = await claimQueuedRow({
      db: mockDb,
      table: mockTable,
      id: "row-123",
    })

    expect(result).toBeNull()
  })
})
