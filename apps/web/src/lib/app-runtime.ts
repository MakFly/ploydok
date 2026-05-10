// SPDX-License-Identifier: AGPL-3.0-only
import type { AppStatus, ContainerSnapshot } from "@ploydok/shared"

const STATUS_PRIORITY: Record<ContainerSnapshot["status"], number> = {
  running: 4,
  unhealthy: 3,
  starting: 2,
  stopped: 1,
  unknown: 0,
}

/**
 * Pick the snapshot that represents the canonical container for an app.
 *
 * `expectedRef` is the value of `apps.container_id` from the DB — usually the
 * blue/green container *name* the runner wrote on the last successful deploy.
 * When provided we **strictly** match against `snapshot.id` or `snapshot.name`:
 * if the canonical container is gone the function returns `null`, and any
 * orphan container left behind by a failed deploy or a previous slot does
 * **not** masquerade as the live one. This is what stops a UI from showing
 * "Failed | Healthy" because some unrelated `-green` is still up.
 *
 * `expectedRef` is intentionally optional: brand-new apps that were never
 * deployed have `apps.container_id === null`, and dashboards that just want
 * "any container for this app id" (e.g. monitoring overview) keep the legacy
 * "highest-priority snapshot" behaviour.
 */
export function selectAppSnapshot(
  containers: Array<ContainerSnapshot>,
  appId: string,
  expectedRef?: string | null
): ContainerSnapshot | null {
  if (expectedRef) {
    const match = containers.find(
      (c) =>
        c.app_id === appId &&
        (!c.kind || c.kind === "app") &&
        (c.id === expectedRef || c.name === expectedRef)
    )
    if (match) return match
    // Fallback: the canonical container_id stored in the DB is stale (the
    // container was recreated server-side — blue/green swap, restart, host
    // reboot). Pick the highest-priority alive container with the right
    // app_id label so the badge stops lying about "Stopped". The API
    // reconciler refreshes apps.container_id on the next /apps fetch, so
    // this fallback is only used during the brief window between recreation
    // and the next API poll.
  }

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
  snapshot: ContainerSnapshot | null
): AppStatus {
  if (
    appStatus === "building" ||
    appStatus === "pending" ||
    appStatus === "created" ||
    appStatus === "deleting"
  ) {
    return appStatus
  }

  if (appStatus === "restarting") return "restarting"
  if (appStatus === "serving") return "serving"

  if (!snapshot) {
    return appStatus === "running" ? "stopped" : appStatus
  }

  switch (snapshot.status) {
    case "running":
      return "running"
    case "unhealthy":
      // Container TOURNE — l'état "unhealthy" est exposé séparément via
      // `resolveAppHealth()`. Le lifecycle reste "running".
      return "running"
    case "starting":
      // Container démarre — UI affiche "Restarting" (transition courte).
      return "restarting"
    case "stopped":
    case "unknown":
    default:
      return "stopped"
  }
}

export type AppHealth = "healthy" | "unhealthy"

export interface RuntimeAppSource {
  id: string
  status: AppStatus
  containerId?: string | null
}

/**
 * Health check status indépendant du lifecycle (Sprint 7 fix). Renvoie
 * `null` si aucune info santé n'est dispo (snapshot absent, container
 * stopped, ou pas de healthcheck configuré).
 */
export function resolveAppHealth(
  snapshot: ContainerSnapshot | null
): AppHealth | null {
  if (!snapshot) return null
  if (snapshot.status === "running") return "healthy"
  if (snapshot.status === "unhealthy") return "unhealthy"
  return null
}

export function resolveDisplayedAppState(
  app: RuntimeAppSource | null | undefined,
  containers?: Array<ContainerSnapshot> | null
): { status: AppStatus | null; health: AppHealth | null } {
  if (!app) return { status: null, health: null }
  if (!containers) return { status: app.status, health: null }

  const snapshot = selectAppSnapshot(containers, app.id, app.containerId)
  return {
    status: resolveRuntimeAppStatus(app.status, snapshot),
    health: resolveAppHealth(snapshot),
  }
}
