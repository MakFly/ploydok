// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, mock, test } from "bun:test"
import type { Db } from "@ploydok/db"
import { ensureProjectDatabasesOnSwarmNetwork } from "./projects"

function dbWithDatabaseRows(
  rows: Array<{ id: string; host: string | null; container_id: string | null }>
): Db {
  return {
    select() {
      return {
        from() {
          return {
            where() {
              return Promise.resolve(rows)
            },
          }
        },
      }
    },
  } as unknown as Db
}

describe("project swarm networks", () => {
  test("attaches managed database containers with their DNS host alias", async () => {
    const networkConnect = mock(async () => undefined)

    const result = await ensureProjectDatabasesOnSwarmNetwork(
      dbWithDatabaseRows([
        {
          id: "db-1",
          host: "ploydok-db-db1",
          container_id: "container-db-1",
        },
      ]),
      "project-1",
      "ploydok-swarm-proj-project-1",
      { networkConnect } as never
    )

    expect(result).toEqual({
      scanned: 1,
      attached: 1,
      alreadyAttached: 0,
    })
    expect(networkConnect).toHaveBeenCalledWith({
      networkId: "ploydok-swarm-proj-project-1",
      containerId: "container-db-1",
      aliases: ["ploydok-db-db1"],
    })
  })

  test("treats already-attached databases as idempotent", async () => {
    const networkConnect = mock(async () => {
      throw new Error("endpoint already exists in network")
    })

    const result = await ensureProjectDatabasesOnSwarmNetwork(
      dbWithDatabaseRows([
        {
          id: "db-1",
          host: "ploydok-db-db1",
          container_id: "container-db-1",
        },
      ]),
      "project-1",
      "ploydok-swarm-proj-project-1",
      { networkConnect } as never
    )

    expect(result).toEqual({
      scanned: 1,
      attached: 0,
      alreadyAttached: 1,
    })
  })
})
