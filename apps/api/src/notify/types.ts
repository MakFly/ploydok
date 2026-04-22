// SPDX-License-Identifier: AGPL-3.0-only
import type { NotificationEvent } from "@ploydok/shared"
import type { notification_channels } from "@ploydok/db"

export type ChannelRow = typeof notification_channels.$inferSelect

export interface NotificationPayload {
  appId: string
  appName: string
  appDomain?: string | null
  commitSha?: string | null
  buildId?: string | null
  durationMs?: number | null
  errorMessage?: string | null
}

export interface NotificationAdapter {
  send(
    channel: ChannelRow,
    event: NotificationEvent,
    payload: NotificationPayload,
  ): Promise<{ ok: boolean; reason?: string }>
}
