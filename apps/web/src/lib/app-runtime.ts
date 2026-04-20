// SPDX-License-Identifier: AGPL-3.0-only
import type { AppStatus, ContainerSnapshot } from "@ploydok/shared"

const STATUS_PRIORITY: Record<ContainerSnapshot["status"], number> = {
  running: 4,
  unhealthy: 3,
  starting: 2,
  stopped: 1,
  unknown: 0,
}

export function selectAppSnapshot(
  containers: Array<ContainerSnapshot>,
  appId: string,
): ContainerSnapshot | null {
  let selected: ContainerSnapshot | null = null

  for (const container of containers) {
    if (container.app_id !== appId) continue
    if (container.kind && container.kind !== "app") continue
    if (!selected) {
      selected = container
      continue
    }

    const statusDiff =
      STATUS_PRIORITY[container.status] - STATUS_PRIORITY[selected.status]
    if (statusDiff > 0) {
      selected = container
      continue
    }
    if (statusDiff === 0 && container.last_seen_ms > selected.last_seen_ms) {
      selected = container
    }
  }

  return selected
}

export function resolveRuntimeAppStatus(
  appStatus: AppStatus,
  snapshot: ContainerSnapshot | null,
): AppStatus {
  if (appStatus === "building" || appStatus === "pending" || appStatus === "created") {
    return appStatus
  }

  if (appStatus === "failed") return "failed"
  if (appStatus === "restarting") return "restarting"

  if (!snapshot) {
    return appStatus === "running" ? "stopped" : appStatus
  }

  switch (snapshot.status) {
    case "running":
      return "running"
    case "starting":
    case "unhealthy":
      return "restarting"
    case "stopped":
    case "unknown":
    default:
      return "stopped"
  }
}
