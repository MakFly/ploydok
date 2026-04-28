// SPDX-License-Identifier: AGPL-3.0-only
import type { NotificationEvent } from "./notifications"

const BUILD_NOTIFICATION_TYPES = new Set<NotificationEvent["type"]>([
  "build.started",
  "build.succeeded",
  "build.failed",
  "deploy.status_change",
])

const ACTIVE_APP_NOTIFICATION_TYPES = new Set<NotificationEvent["type"]>([
  "app.delete.queued",
  "app.stop.queued",
  "app.stopped",
  "app.stop.failed",
])

const PROVIDER_SYNC_TYPES = new Set<NotificationEvent["type"]>([
  "provider.sync.started",
  "provider.sync.completed",
  "provider.sync.failed",
])

export function resolveNotificationHref(
  item: NotificationEvent,
  orgSlug: string | null | undefined,
): string | null {
  if (PROVIDER_SYNC_TYPES.has(item.type)) {
    return "/settings/git-providers"
  }

  if (!orgSlug || !item.appId) return null

  if (BUILD_NOTIFICATION_TYPES.has(item.type)) {
    const base = `/orgs/${orgSlug}/apps/${item.appId}/deployments`
    return item.buildId ? `${base}?build=${encodeURIComponent(item.buildId)}` : base
  }

  if (item.type === "container.health") {
    return `/orgs/${orgSlug}/apps/${item.appId}/overview`
  }

  if (ACTIVE_APP_NOTIFICATION_TYPES.has(item.type)) {
    return `/orgs/${orgSlug}/apps/${item.appId}/settings`
  }

  return null
}
