// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, mock, test } from "bun:test"
import type { Db, Redis } from "@ploydok/db"
import type { Agent } from "../../agent"
import type {
  RestartAppForRecovery,
  RuntimeRecoveryApp,
} from "../../services/app-runtime-reconciler"
import type { AppContainerIndex } from "../../services/app-status-reconciler"
import type { dispatch } from "../../notify/index"
import {
  MAX_RESTARTS,
  WINDOW_MS,
  recordRestart,
  runAutoHealOnce,
  withinBudget,
  type RestartBudgetState,
} from "./auto-heal"

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
  snapshots: Array<{ id: string; name: string; appId: string; status: string }>
): AppContainerIndex {
  const byContainerId = new Map()
  const byContainerName = new Map()
  const bestByAppId = new Map()

  for (const snap of snapshots) {
    const lite = { ...snap, lastSeenMs: 1 }
    byContainerId.set(lite.id, lite)
    byContainerName.set(lite.name, lite)
    bestByAppId.set(lite.appId, lite)
  }

  return { byContainerId, byContainerName, bestByAppId }
}

type MetaRow = {
  id: string
  name: string
  project_id: string
  owner_id: string
}

function fakeDb(candidates: RuntimeRecoveryApp[], meta: MetaRow[]): Db {
  return {
    select() {
      let joined = false
      const chain = {
        from() {
          return chain
        },
        innerJoin() {
          joined = true
          return chain
        },
        where() {
          return Promise.resolve(joined ? meta : candidates)
        },
      }
      return chain
    },
  } as unknown as Db
}

function fakeRedis(): Redis {
  const strings = new Map<string, string>()
  const budgets = new Map<string, number[]>()
  return {
    async set(key: string, value: string, ...args: Array<unknown>) {
      const nx = args.includes("NX")
      if (nx && strings.has(key)) return null
      strings.set(key, value)
      return "OK"
    },
    async del(key: string) {
      return strings.delete(key) ? 1 : 0
    },
    async eval(script: string, _keys: number, key: string, ...args: string[]) {
      if (script.includes("ZREMRANGEBYSCORE")) {
        const cutoff = Number(args[0])
        const max = Number(args[1])
        const now = Number(args[2])
        const recent = (budgets.get(key) ?? []).filter((at) => at > cutoff)
        if (recent.length >= max) {
          budgets.set(key, recent)
          return 0
        }
        recent.push(now)
        budgets.set(key, recent)
        return 1
      }
      if (strings.get(key) === args[0]) {
        strings.delete(key)
        return 1
      }
      return 0
    },
  } as unknown as Redis
}

describe("auto-heal restart budget", () => {
  test("allows up to N restarts within the window", () => {
    let state: RestartBudgetState = { timestamps: [] }
    const t0 = 1_000_000

    for (let i = 0; i < MAX_RESTARTS; i++) {
      expect(withinBudget(state, t0, MAX_RESTARTS, WINDOW_MS)).toBe(true)
      state = recordRestart(state, t0, WINDOW_MS)
    }

    expect(state.timestamps.length).toBe(MAX_RESTARTS)
  })

  test("blocks the N+1th restart within the window", () => {
    let state: RestartBudgetState = { timestamps: [] }
    const t0 = 1_000_000

    for (let i = 0; i < MAX_RESTARTS; i++) {
      state = recordRestart(state, t0, WINDOW_MS)
    }

    expect(withinBudget(state, t0, MAX_RESTARTS, WINDOW_MS)).toBe(false)
  })

  test("resets after the window elapses", () => {
    let state: RestartBudgetState = { timestamps: [] }
    const t0 = 1_000_000

    for (let i = 0; i < MAX_RESTARTS; i++) {
      state = recordRestart(state, t0, WINDOW_MS)
    }
    expect(withinBudget(state, t0, MAX_RESTARTS, WINDOW_MS)).toBe(false)

    const later = t0 + WINDOW_MS + 1
    expect(withinBudget(state, later, MAX_RESTARTS, WINDOW_MS)).toBe(true)
  })
})

describe("runAutoHealOnce", () => {
  test("restarts an unhealthy app within budget and dispatches app.autohealed", async () => {
    const appId = "heal-app"
    const candidates = [
      app({ id: appId, container_id: "ploydok-heal-app-blue" }),
    ]
    const meta = [
      { id: appId, name: "Heal App", project_id: "proj-1", owner_id: "user-1" },
    ]
    const db = fakeDb(candidates, meta)
    const restartApp = mock(async () => undefined)
    const dispatchMock = mock(async () => undefined)

    const result = await runAutoHealOnce(db, {} as Agent, fakeRedis(), {
      restartApp,
      dispatch: dispatchMock,
      loadIndex: async () =>
        index([
          {
            id: "cid-1",
            name: "ploydok-heal-app-blue",
            appId,
            status: "unhealthy",
          },
        ]),
    })

    expect(result).toMatchObject({
      scanned: 1,
      healed: 1,
      gaveUp: 0,
      skipped: 0,
    })
    expect(restartApp).toHaveBeenCalledTimes(1)
    const restartCalls = restartApp.mock.calls as unknown as Array<
      Parameters<RestartAppForRecovery>
    >
    expect(restartCalls[0]?.[0]).toBe(appId)
    expect(restartCalls[0]?.[3]).toEqual({ background: false })
    expect(dispatchMock).toHaveBeenCalledTimes(1)
    const dispatchCalls = dispatchMock.mock.calls as unknown as Array<
      Parameters<typeof dispatch>
    >
    expect(dispatchCalls[0]?.[2]).toBe("app.autohealed")
  })

  test("leaves a healthy (running) app untouched", async () => {
    const appId = "healthy-app"
    const candidates = [
      app({ id: appId, container_id: "ploydok-healthy-app-blue" }),
    ]
    const db = fakeDb(candidates, [])
    const restartApp = mock(async () => undefined)
    const dispatchMock = mock(async () => undefined)

    const result = await runAutoHealOnce(db, {} as Agent, fakeRedis(), {
      restartApp,
      dispatch: dispatchMock,
      loadIndex: async () =>
        index([
          {
            id: "cid-2",
            name: "ploydok-healthy-app-blue",
            appId,
            status: "running",
          },
        ]),
    })

    expect(result).toMatchObject({
      scanned: 1,
      healed: 0,
      gaveUp: 0,
      skipped: 1,
    })
    expect(restartApp).not.toHaveBeenCalled()
    expect(dispatchMock).not.toHaveBeenCalled()
  })

  test("stops restarting past budget and dispatches app.autoheal_failed exactly once", async () => {
    const appId = "crashloop-app"
    const candidates = [
      app({ id: appId, container_id: "ploydok-crashloop-app-blue" }),
    ]
    const meta = [
      {
        id: appId,
        name: "Crashloop App",
        project_id: "proj-2",
        owner_id: "user-2",
      },
    ]
    const db = fakeDb(candidates, meta)
    const restartApp = mock(async () => undefined)
    const dispatchMock = mock(async () => undefined)
    const loadIndex = async () =>
      index([
        {
          id: "cid-3",
          name: "ploydok-crashloop-app-blue",
          appId,
          status: "unhealthy",
        },
      ])

    let nowMs = 2_000_000
    const redis = fakeRedis()
    const deps = {
      restartApp,
      dispatch: dispatchMock,
      loadIndex,
      now: () => nowMs,
    }

    // First MAX_RESTARTS ticks heal the app (within budget).
    for (let i = 0; i < MAX_RESTARTS; i++) {
      const result = await runAutoHealOnce(db, {} as Agent, redis, deps)
      expect(result.healed).toBe(1)
      nowMs += 1_000
    }
    expect(restartApp).toHaveBeenCalledTimes(MAX_RESTARTS)

    // Budget exhausted — next tick gives up and notifies once.
    const gaveUpResult = await runAutoHealOnce(db, {} as Agent, redis, deps)
    expect(gaveUpResult).toMatchObject({ healed: 0, gaveUp: 1 })
    expect(restartApp).toHaveBeenCalledTimes(MAX_RESTARTS)

    // A further tick while still exhausted must not spam the notification.
    nowMs += 1_000
    const stillGaveUpResult = await runAutoHealOnce(
      db,
      {} as Agent,
      redis,
      deps
    )
    expect(stillGaveUpResult).toMatchObject({ healed: 0, gaveUp: 1 })

    const dispatchCalls = dispatchMock.mock.calls as unknown as Array<
      Parameters<typeof dispatch>
    >
    const autohealFailedCalls = dispatchCalls.filter(
      (call) => call[2] === "app.autoheal_failed"
    )
    expect(autohealFailedCalls.length).toBe(1)
  })
})
