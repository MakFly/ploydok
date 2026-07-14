// SPDX-License-Identifier: AGPL-3.0-only
//
// Runtime recovery at API boot. Docker restart policies normally keep runtime
// containers alive across daemon/host restarts, but Ploydok can still observe a
// missing runtime after an interrupted manual restart or external container
// removal. In that case the DB remains the source of intent: apps that were
// supposed to be running are restarted from their last succeeded build.

import { and, inArray } from "drizzle-orm"
import { apps } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import type { Agent } from "../agent"
import { childLogger } from "../logger"
import {
  loadAppContainerIndex,
  type AppContainerIndex,
} from "./app-status-reconciler"

const log = childLogger("apps.runtime-reconciler")

type RuntimeRecoveryStatus = "running" | "restarting"
type RuntimeRecoveryPolicy = "always" | "unless-stopped"

export type RuntimeRecoveryApp = {
  id: string
  status: string | null
  container_id: string | null
  restart_policy: string | null
  build_method: string | null
}

export type RestartAppForRecovery = (
  appId: string,
  db: Db,
  userId: undefined,
  opts: { background: boolean }
) => Promise<void>

export type RuntimeRecoveryResult = {
  scanned: number
  alreadyLive: number
  skipped: number
  scheduled: number
  failed: number
}

const RECOVERABLE_STATUSES: RuntimeRecoveryStatus[] = ["running", "restarting"]
const RECOVERABLE_POLICIES: RuntimeRecoveryPolicy[] = [
  "always",
  "unless-stopped",
]
const LIVE_STATUSES = new Set(["running", "starting", "unhealthy"])

function isRecoverableIntent(app: RuntimeRecoveryApp): boolean {
  return (
    RECOVERABLE_STATUSES.includes(app.status as RuntimeRecoveryStatus) &&
    RECOVERABLE_POLICIES.includes(
      app.restart_policy as RuntimeRecoveryPolicy
    ) &&
    app.build_method !== "static"
  )
}

export function hasLiveRuntime(
  app: RuntimeRecoveryApp,
  index: AppContainerIndex
): boolean {
  let snap =
    app.container_id !== null
      ? (index.byContainerId.get(app.container_id) ??
        index.byContainerName.get(app.container_id))
      : undefined

  if (!snap) {
    snap = index.bestByAppId.get(app.id)
  }

  return snap ? LIVE_STATUSES.has(snap.status) : false
}

export function shouldScheduleRuntimeRecovery(
  app: RuntimeRecoveryApp,
  index: AppContainerIndex
): boolean {
  return isRecoverableIntent(app) && !hasLiveRuntime(app, index)
}

export async function fetchRuntimeRecoveryCandidates(
  db: Db
): Promise<RuntimeRecoveryApp[]> {
  return db
    .select({
      id: apps.id,
      status: apps.status,
      container_id: apps.container_id,
      restart_policy: apps.restart_policy,
      build_method: apps.build_method,
    })
    .from(apps)
    .where(
      and(
        inArray(apps.status, RECOVERABLE_STATUSES),
        inArray(apps.restart_policy, RECOVERABLE_POLICIES)
      )
    )
}

export async function reconcileRuntimeAppsOnBoot(
  db: Db,
  agent: Agent,
  deps: {
    restartApp?: RestartAppForRecovery
    loadIndex?: (agent: Agent) => Promise<AppContainerIndex | null>
  } = {}
): Promise<RuntimeRecoveryResult> {
  const result: RuntimeRecoveryResult = {
    scanned: 0,
    alreadyLive: 0,
    skipped: 0,
    scheduled: 0,
    failed: 0,
  }

  const index = await (deps.loadIndex ?? loadAppContainerIndex)(agent)
  if (!index) {
    log.warn("runtime reconcile skipped: container snapshot unavailable")
    return result
  }

  const rows = await fetchRuntimeRecoveryCandidates(db)
  result.scanned = rows.length

  const restartApp =
    deps.restartApp ?? (await import("../worker/runner.js")).restartApp

  for (const app of rows) {
    if (!isRecoverableIntent(app)) {
      result.skipped++
      continue
    }

    if (hasLiveRuntime(app, index)) {
      result.alreadyLive++
      continue
    }

    try {
      await restartApp(app.id, db, undefined, { background: true })
      result.scheduled++
      log.info({ appId: app.id }, "runtime recovery scheduled")
    } catch (err) {
      result.failed++
      log.warn({ err, appId: app.id }, "runtime recovery scheduling failed")
    }
  }

  log.info(result, "runtime reconcile complete")
  return result
}
