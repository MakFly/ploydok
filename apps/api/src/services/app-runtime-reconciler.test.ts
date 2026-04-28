// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, mock, test } from "bun:test"
import type { Db } from "@ploydok/db"
import type { Agent } from "../agent"
import {
  hasLiveRuntime,
  reconcileRuntimeAppsOnBoot,
  shouldScheduleRuntimeRecovery,
  type RestartAppForRecovery,
  type RuntimeRecoveryApp,
} from "./app-runtime-reconciler"
import type { AppContainerIndex } from "./app-status-reconciler"

function app(overrides: Partial<RuntimeRecoveryApp> = {}): RuntimeRecoveryApp {
  return {
    id: overrides.id ?? "app-1",
    status: overrides.status ?? "running",
    container_id:
      "container_id" in overrides
        ? overrides.container_id!
        : "ploydok-app-one-blue",
    restart_policy: overrides.restart_policy ?? "unless-stopped",
    build_method: overrides.build_method ?? "nixpacks",
  }
}

function index(
  snapshots: Array<{
    id: string
    name: string
    appId: string
    status: string
    lastSeenMs?: number
  }> = []
): AppContainerIndex {
  const byContainerId = new Map()
  const byContainerName = new Map()
  const bestByAppId = new Map()

  for (const snap of snapshots) {
    const lite = {
      id: snap.id,
      name: snap.name,
      appId: snap.appId,
      status: snap.status,
      lastSeenMs: snap.lastSeenMs ?? 1,
    }
    byContainerId.set(lite.id, lite)
    byContainerName.set(lite.name, lite)
    bestByAppId.set(lite.appId, lite)
  }

  return { byContainerId, byContainerName, bestByAppId }
}

function dbWithRows(rows: RuntimeRecoveryApp[]): Db {
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

describe("app runtime reconciler", () => {
  test("detects a live runtime by container name", () => {
    const row = app({ container_id: "ploydok-app-one-blue" })
    const snapshots = index([
      {
        id: "cid-1",
        name: "ploydok-app-one-blue",
        appId: "app-1",
        status: "running",
      },
    ])

    expect(hasLiveRuntime(row, snapshots)).toBe(true)
    expect(shouldScheduleRuntimeRecovery(row, snapshots)).toBe(false)
  })

  test("schedules recovery when a running app has no live container", () => {
    expect(shouldScheduleRuntimeRecovery(app(), index())).toBe(true)
  })

  test("does not recover stopped, static, or explicitly disabled apps", () => {
    const snapshots = index()

    expect(
      shouldScheduleRuntimeRecovery(app({ status: "stopped" }), snapshots)
    ).toBe(false)
    expect(
      shouldScheduleRuntimeRecovery(app({ build_method: "static" }), snapshots)
    ).toBe(false)
    expect(
      shouldScheduleRuntimeRecovery(app({ restart_policy: "no" }), snapshots)
    ).toBe(false)
  })

  test("boot reconcile schedules only missing runtime apps", async () => {
    const rows = [
      app({ id: "missing", container_id: "ploydok-app-missing-blue" }),
      app({ id: "live", container_id: "ploydok-app-live-blue" }),
    ]
    const restartApp = mock(async () => undefined)

    const result = await reconcileRuntimeAppsOnBoot(
      dbWithRows(rows),
      {} as Agent,
      {
        restartApp,
        loadIndex: async () =>
          index([
            {
              id: "cid-live",
              name: "ploydok-app-live-blue",
              appId: "live",
              status: "running",
            },
          ]),
      }
    )

    expect(result).toMatchObject({
      scanned: 2,
      alreadyLive: 1,
      scheduled: 1,
      failed: 0,
    })
    expect(restartApp).toHaveBeenCalledTimes(1)
    const calls = restartApp.mock.calls as unknown as Array<
      Parameters<RestartAppForRecovery>
    >
    expect(calls[0]?.[0]).toBe("missing")
    expect(calls[0]?.[3]).toEqual({ background: true })
  })

  test("boot reconcile reports restart scheduling failures", async () => {
    const restartApp = mock(async () => {
      throw new Error("no succeeded build")
    })

    const result = await reconcileRuntimeAppsOnBoot(
      dbWithRows([app({ id: "missing" })]),
      {} as Agent,
      {
        restartApp,
        loadIndex: async () => index(),
      }
    )

    expect(result).toMatchObject({
      scanned: 1,
      scheduled: 0,
      failed: 1,
    })
  })
})
