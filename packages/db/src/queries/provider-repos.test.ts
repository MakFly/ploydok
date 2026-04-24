// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, mock, beforeEach } from "bun:test"
import type { Db } from "../client"
import {
  listRepos,
  upsertRepos,
  deleteRepos,
  replaceInstallationRepos,
  getInstallationStaleness,
  type ProviderRepoRow,
} from "./provider-repos"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRepo(overrides: Partial<ProviderRepoRow> = {}): ProviderRepoRow {
  return {
    id: "github:123",
    installation_id: "github:install:1",
    provider: "github",
    full_name: "acme/my-repo",
    name: "my-repo",
    description: "A great repo",
    default_branch: "main",
    private: false,
    html_url: "https://github.com/acme/my-repo",
    pushed_at: new Date("2024-01-01"),
    updated_at: new Date("2024-01-01"),
    last_synced_at: new Date("2024-01-01"),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// listRepos — search + pagination
// ---------------------------------------------------------------------------

describe("listRepos", () => {
  it("applies search ILIKE on full_name OR description and returns paginatedrows with total", async () => {
    const fakeRows = [makeRepo(), makeRepo({ id: "github:456", full_name: "acme/other" })]
    const mockDb = {
      select: mock(() => mockDb),
      from: mock(() => mockDb),
      where: mock(() => mockDb),
      orderBy: mock(() => mockDb),
      limit: mock(() => mockDb),
      offset: mock(() => Promise.resolve(fakeRows)),
    } as unknown as Db

    // Override: second call (count) returns totalRow
    let callCount = 0
    const selectSpy = mock(() => {
      callCount++
      if (callCount === 1) {
        // first call is the rows query chain
        return {
          from: mock(() => ({
            where: mock(() => ({
              orderBy: mock(() => ({
                limit: mock(() => ({
                  offset: mock(() => Promise.resolve(fakeRows)),
                })),
              })),
            })),
          })),
        }
      }
      // second call is the count query chain
      return {
        from: mock(() => ({
          where: mock(() => Promise.resolve([{ total: 2 }])),
        })),
      }
    })

    const db = { select: selectSpy } as unknown as Db

    const result = await listRepos(db, {
      provider: "github",
      search: "acme",
      limit: 10,
      offset: 0,
    })

    expect(selectSpy).toHaveBeenCalledTimes(2)
    expect(result.rows).toEqual(fakeRows)
    expect(result.total).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// upsertRepos — no-op on empty array
// ---------------------------------------------------------------------------

describe("upsertRepos", () => {
  it("no-ops when rows array is empty", async () => {
    const insertSpy = mock(() => ({ values: mock(() => ({ onConflictDoUpdate: mock(() => Promise.resolve()) })) }))
    const db = { insert: insertSpy } as unknown as Db

    await upsertRepos(db, [])

    expect(insertSpy).not.toHaveBeenCalled()
  })

  it("calls insert when rows is non-empty", async () => {
    const onConflictSpy = mock(() => Promise.resolve())
    const valuesSpy = mock(() => ({ onConflictDoUpdate: onConflictSpy }))
    const insertSpy = mock(() => ({ values: valuesSpy }))
    const db = { insert: insertSpy } as unknown as Db

    await upsertRepos(db, [makeRepo()])

    expect(insertSpy).toHaveBeenCalledTimes(1)
    expect(valuesSpy).toHaveBeenCalledTimes(1)
    expect(onConflictSpy).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// deleteRepos — no-op on empty array
// ---------------------------------------------------------------------------

describe("deleteRepos", () => {
  it("no-ops when ids array is empty", async () => {
    const deleteSpy = mock(() => ({ where: mock(() => Promise.resolve()) }))
    const db = { delete: deleteSpy } as unknown as Db

    await deleteRepos(db, [])

    expect(deleteSpy).not.toHaveBeenCalled()
  })

  it("calls delete when ids is non-empty", async () => {
    const whereSpy = mock(() => Promise.resolve())
    const deleteSpy = mock(() => ({ where: whereSpy }))
    const db = { delete: deleteSpy } as unknown as Db

    await deleteRepos(db, ["github:123"])

    expect(deleteSpy).toHaveBeenCalledTimes(1)
    expect(whereSpy).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// replaceInstallationRepos — upsert + delete-not-in inside transaction
// ---------------------------------------------------------------------------

describe("replaceInstallationRepos", () => {
  it("issues upsert and DELETE-NOT-IN inside a transaction", async () => {
    const deleteSpy = mock(() => ({ where: mock(() => Promise.resolve()) }))
    const onConflictSpy = mock(() => Promise.resolve())
    const valuesSpy = mock(() => ({ onConflictDoUpdate: onConflictSpy }))
    const insertSpy = mock(() => ({ values: valuesSpy }))

    const txMock = {
      insert: insertSpy,
      delete: deleteSpy,
    }

    const db = {
      transaction: mock(async (fn: (tx: unknown) => Promise<void>) => {
        await fn(txMock)
      }),
    } as unknown as Db

    const rows = [makeRepo()]
    await replaceInstallationRepos(db, "github:install:1", rows)

    expect(insertSpy).toHaveBeenCalledTimes(1)
    expect(onConflictSpy).toHaveBeenCalledTimes(1)
    expect(deleteSpy).toHaveBeenCalledTimes(1)
  })

  it("deletes all repos when rows is empty", async () => {
    const deleteSpy = mock(() => ({ where: mock(() => Promise.resolve()) }))

    const txMock = {
      insert: mock(() => ({ values: mock(() => ({ onConflictDoUpdate: mock(() => Promise.resolve()) })) })),
      delete: deleteSpy,
    }

    const db = {
      transaction: mock(async (fn: (tx: unknown) => Promise<void>) => {
        await fn(txMock)
      }),
    } as unknown as Db

    await replaceInstallationRepos(db, "github:install:1", [])

    // delete is called once (delete all with installation_id)
    expect(deleteSpy).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// getInstallationStaleness — returns null when no rows
// ---------------------------------------------------------------------------

describe("getInstallationStaleness", () => {
  it("returns null mostStaleAt and 0 count when no installations exist", async () => {
    const db = {
      select: mock(() => ({
        from: mock(() => ({
          where: mock(() => Promise.resolve([])),
        })),
      })),
    } as unknown as Db

    const result = await getInstallationStaleness(db, "github")

    expect(result.mostStaleAt).toBeNull()
    expect(result.count).toBe(0)
  })

  it("returns mostStaleAt and count when installations exist", async () => {
    const staleDate = new Date("2024-01-01")
    const db = {
      select: mock(() => ({
        from: mock(() => ({
          where: mock(() => Promise.resolve([{ mostStaleAt: staleDate, count: 3 }])),
        })),
      })),
    } as unknown as Db

    const result = await getInstallationStaleness(db, "github")

    expect(result.mostStaleAt).toEqual(staleDate)
    expect(result.count).toBe(3)
  })
})
