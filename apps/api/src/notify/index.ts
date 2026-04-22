// SPDX-License-Identifier: AGPL-3.0-only
import { and, eq, isNull, or } from "drizzle-orm"
import { notification_channels } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import type { Redis } from "@ploydok/db"
import type { NotificationEvent } from "@ploydok/shared"
import type { NotificationAdapter, NotificationPayload } from "./types"
import { discordAdapter } from "./discord"
import { slackAdapter } from "./slack"
import { telegramAdapter } from "./telegram"
import { whatsappAdapter } from "./whatsapp"
import { emailAdapter } from "./email"
import { childLogger } from "../logger"

const log = childLogger("notify.dispatcher")

const ADAPTERS: Record<string, NotificationAdapter> = {
  discord: discordAdapter,
  slack: slackAdapter,
  telegram: telegramAdapter,
  whatsapp: whatsappAdapter,
  email: emailAdapter,
}

interface DispatchScope {
  userId: string
  projectId?: string | null
}

export async function dispatch(
  db: Db,
  redis: Redis,
  event: NotificationEvent,
  payload: NotificationPayload,
  scope: DispatchScope,
): Promise<void> {
  let channels
  try {
    channels = await db
      .select()
      .from(notification_channels)
      .where(
        and(
          eq(notification_channels.owner_id, scope.userId),
          or(
            isNull(notification_channels.project_id),
            scope.projectId ? eq(notification_channels.project_id, scope.projectId) : isNull(notification_channels.project_id),
          ),
          eq(notification_channels.enabled, true),
        ),
      )
  } catch (err) {
    log.error({ err, event, userId: scope.userId }, "failed to query notification channels")
    return
  }

  const matching = channels.filter((ch) => {
    const events = ch.events as string[]
    return events.includes(event)
  })

  if (matching.length === 0) return

  const dedupKey = `notify:dedup:${scope.userId}:${event}:${payload.commitSha ?? "none"}`
  try {
    const already = await redis.set(dedupKey, "1", "EX", 60, "NX")
    if (already === null) {
      log.debug({ event, userId: scope.userId }, "notification deduped (within 60s)")
      return
    }
  } catch (err) {
    log.warn({ err }, "Redis dedup check failed — proceeding without dedup")
  }

  for (const ch of matching) {
    const adapter = ADAPTERS[ch.kind]
    if (!adapter) {
      log.warn({ kind: ch.kind, channelId: ch.id }, "no adapter for kind")
      continue
    }

    let result: { ok: boolean; reason?: string }
    try {
      result = await adapter.send(ch, event, payload)
    } catch (err) {
      result = { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }

    try {
      await db
        .update(notification_channels)
        .set(
          result.ok
            ? { last_sent_at: new Date(), last_error: null }
            : { last_error: result.reason?.slice(0, 500) ?? "unknown error" },
        )
        .where(eq(notification_channels.id, ch.id))
    } catch (updateErr) {
      log.warn({ updateErr, channelId: ch.id }, "failed to update channel after send")
    }

    if (!result.ok) {
      log.warn({ event, channelId: ch.id, kind: ch.kind, reason: result.reason }, "notification send failed (non-fatal)")
    } else {
      log.debug({ event, channelId: ch.id, kind: ch.kind }, "notification sent")
    }
  }
}
