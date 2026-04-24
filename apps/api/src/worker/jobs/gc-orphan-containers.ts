// SPDX-License-Identifier: AGPL-3.0-only
import { apps } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { getSharedAgent } from "../../debug/singletons"
import { childLogger } from "../../logger"

const log = childLogger("gc.orphan-containers")

const TEN_MIN_MS = 10 * 60 * 1000
const ORPHAN_MIN_UPTIME_S = 24 * 60 * 60

let _timer: ReturnType<typeof setInterval> | null = null

export interface OrphanGcResult {
  scanned: number
  removed: string[]
}

/**
 * Find containers labelled `ploydok.kind=app` whose `ploydok.app_id` is not
 * in the `apps` table, and remove them after a safety age threshold. Protects
 * against leftover blue/green containers when a deploy crashes between DB
 * commit and container cleanup, or legacy state from an earlier Ploydok
 * version.
 *
 * Grace period: `ORPHAN_MIN_UPTIME_S` (24h) so a just-started container never
 * races the deploy that created it.
 */
export async function runOrphanContainerGc(db: Db): Promise<OrphanGcResult> {
  const agent = getSharedAgent()
  const resp = await agent.listContainers({ kindFilter: "app" })
  const live = await db.select({ id: apps.id }).from(apps)
  const liveIds = new Set(live.map((r) => r.id))

  const result: OrphanGcResult = {
    scanned: resp.containers.length,
    removed: [],
  }

  for (const c of resp.containers) {
    if (!c.appId) continue
    if (liveIds.has(c.appId)) continue
    if ((c.uptimeS ?? 0) < ORPHAN_MIN_UPTIME_S) continue

    try {
      await agent.containerRemove({
        containerId: c.id,
        force: true,
        removeVolumes: false,
      })
      result.removed.push(c.name)
      log.info({ name: c.name, appId: c.appId }, "removed orphan container")
    } catch (err) {
      log.warn({ err, name: c.name }, "failed to remove orphan container")
    }
  }

  log.info(result, "orphan container GC tick complete")
  return result
}

export function startOrphanContainerGcCron(db: Db): void {
  stopOrphanContainerGcCron()

  async function tick() {
    try {
      await runOrphanContainerGc(db)
    } catch (err) {
      log.error({ err }, "orphan container GC tick error")
    }
  }

  _timer = setInterval(() => void tick(), TEN_MIN_MS)
  log.info({ intervalMin: 10 }, "orphan container GC cron scheduled")
}

export function stopOrphanContainerGcCron(): void {
  if (_timer !== null) {
    clearInterval(_timer)
    _timer = null
  }
}
