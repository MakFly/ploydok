// SPDX-License-Identifier: AGPL-3.0-only
import { eq } from "drizzle-orm"
import { apps, type Db } from "@ploydok/db"
import { listSwarmTasks } from "../worker/swarm-runner.js"

function isUsableTaskStatus(status: string): boolean {
  const normalized = status.toLowerCase()
  return (
    (normalized.includes("up ") || normalized.includes("running")) &&
    !normalized.includes("unhealthy")
  )
}

export async function resolveAppRuntimeContainerId(
  db: Db,
  appId: string,
  preferredContainerId?: string | null
): Promise<string | null> {
  const rows = await db
    .select({
      runtime_mode: apps.runtime_mode,
      container_id: apps.container_id,
      swarm_service_name: apps.swarm_service_name,
    })
    .from(apps)
    .where(eq(apps.id, appId))
    .limit(1)
  const app = rows[0]
  if (!app) return null
  if (preferredContainerId) return preferredContainerId
  if (app.runtime_mode !== "swarm") return app.container_id ?? null
  const tasks = await listSwarmTasks(appId, db)
  const selected =
    tasks.find((task) => isUsableTaskStatus(task.status)) ?? tasks[0] ?? null
  return selected?.containerId || null
}
