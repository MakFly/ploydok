// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "bun:test"
import type { Db } from "@ploydok/db"
import { reapStuckBuilds } from "./reap-stuck-builds"

function queryResult<T>(rows: T[]) {
  return {
    from() {
      return this
    },
    where() {
      return this
    },
    limit() {
      return Promise.resolve(rows)
    },
    then(resolve: (value: T[]) => void, reject: (reason: unknown) => void) {
      return Promise.resolve(rows).then(resolve, reject)
    },
  }
}

function fakeDb(selectRows: Array<Array<Record<string, unknown>>>) {
  const updates: Array<Record<string, unknown>> = []

  return {
    db: {
      select() {
        const rows = selectRows.shift() ?? []
        return queryResult(rows)
      },
      update() {
        return {
          set(values: Record<string, unknown>) {
            updates.push(values)
            return {
              where() {
                return Promise.resolve()
              },
            }
          },
        }
      },
    } as unknown as Db,
    updates,
  }
}

describe("reapStuckBuilds", () => {
  it("marks a building app failed when its last running build is reaped", async () => {
    const { db, updates } = fakeDb([
      [{ id: "build-1", app_id: "app-1", status: "running" }],
      [{ id: "build-1", app_id: "app-1", status: "cancelled" }],
      [],
      [{ status: "building", container_id: null }],
      [],
    ])

    const result = await reapStuckBuilds(db)

    expect(result.reaped).toEqual(["build-1"])
    expect(updates).toContainEqual(
      expect.objectContaining({ status: "cancelled" })
    )
    expect(updates).toContainEqual(
      expect.objectContaining({ status: "failed" })
    )
  })

  it("returns a building app to running when an existing container is still tracked", async () => {
    const { db, updates } = fakeDb([
      [{ id: "build-1", app_id: "app-1", status: "running" }],
      [{ id: "build-1", app_id: "app-1", status: "cancelled" }],
      [],
      [{ status: "building", container_id: "ploydok-app-app-1-green" }],
      [],
    ])

    await reapStuckBuilds(db)

    expect(updates).toContainEqual(
      expect.objectContaining({ status: "running" })
    )
  })

  it("does not change app status while another build is still active", async () => {
    const { db, updates } = fakeDb([
      [{ id: "build-1", app_id: "app-1", status: "running" }],
      [{ id: "build-1", app_id: "app-1", status: "cancelled" }],
      [{ id: "build-2" }],
      [],
    ])

    await reapStuckBuilds(db)

    expect(updates).toContainEqual(
      expect.objectContaining({ status: "cancelled" })
    )
    expect(updates).not.toContainEqual(
      expect.objectContaining({ status: "failed" })
    )
    expect(updates).not.toContainEqual(
      expect.objectContaining({ status: "running" })
    )
  })
})
