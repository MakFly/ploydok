// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, mock } from "bun:test"
import type { Db } from "@ploydok/db"
import {
  DeployCancelledError,
  DeployLeaseLostError,
  fenceDeploySideEffect,
  runOwnedDeployReconciliation,
  withAppDeployLease,
} from "./app-deploy-lock"

function fakeDb(results: unknown[][]) {
  const execute = mock(async () => results.shift() ?? [])
  return { db: { execute } as unknown as Db, execute }
}

describe("durable app deploy lease", () => {
  it("runs only after a token was durably acquired and releases it", async () => {
    const { db, execute } = fakeDb([
      [{ lease_token: "token-1" }],
      [{ lease_token: "token-1", cancelled: false }],
      [],
    ])
    await expect(
      withAppDeployLease(db, "app-1", "build-1", async () => "ok", {
        token: "token-1",
      })
    ).resolves.toBe("ok")
    expect(execute).toHaveBeenCalledTimes(3)
  })

  it("rejects when another worker owns the unexpired lease", async () => {
    const { db } = fakeDb([[]])
    await expect(
      withAppDeployLease(db, "app-1", "build-2", async () => undefined)
    ).rejects.toBeInstanceOf(DeployLeaseLostError)
  })

  it("stops at the next fence after cancellation intent", async () => {
    const { db, execute } = fakeDb([])
    let calls = 0
    execute.mockImplementation(async () => {
      calls += 1
      if (calls === 1) {
        return [{ lease_token: "token-1" }]
      }
      if (calls === 2) return [{ lease_token: "owned", cancelled: false }]
      if (calls === 3) return [{ lease_token: "owned", cancelled: true }]
      return []
    })
    await expect(
      withAppDeployLease(
        db,
        "app-1",
        "build-1",
        async () => {
          await fenceDeploySideEffect()
        },
        { token: "token-1" }
      )
    ).rejects.toBeInstanceOf(DeployCancelledError)
  })

  it("does not run stale cleanup after a successor replaced the token", async () => {
    const { db } = fakeDb([
      [{ lease_token: "stale-token" }],
      [{ lease_token: "stale-token", cancelled: false }],
      [],
      [],
    ])
    const cleanup = mock(async () => undefined)
    await withAppDeployLease(
      db,
      "app-1",
      "build-stale",
      async () => {
        await expect(runOwnedDeployReconciliation(cleanup)).resolves.toBe(false)
      },
      { token: "stale-token" }
    )
    expect(cleanup).not.toHaveBeenCalled()
  })

  it("allows cancellation cleanup while the exact token is still owner", async () => {
    const { db } = fakeDb([
      [{ lease_token: "cancel-token" }],
      [{ lease_token: "cancel-token", cancelled: false }],
      [{ owned: true }],
      [],
    ])
    const cleanup = mock(async () => undefined)
    await withAppDeployLease(
      db,
      "app-1",
      "build-cancelled",
      async () => {
        await expect(runOwnedDeployReconciliation(cleanup)).resolves.toBe(true)
      },
      { token: "cancel-token" }
    )
    expect(cleanup).toHaveBeenCalledTimes(1)
  })
})
