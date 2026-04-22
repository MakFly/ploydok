// SPDX-License-Identifier: AGPL-3.0-only
import { DiscordConfigSchema } from "@ploydok/shared"
import type { NotificationEvent } from "@ploydok/shared"
import type { NotificationAdapter, ChannelRow, NotificationPayload } from "./types"
import { childLogger } from "../logger"

const log = childLogger("notify.discord")

const EVENT_COLORS: Record<NotificationEvent, number> = {
  "build.started": 0xf0a500,
  "build.succeeded": 0x57f287,
  "build.failed": 0xed4245,
  "deploy.succeeded": 0x57f287,
  "deploy.failed": 0xed4245,
  "webhook.rotated": 0x5865f2,
  "db.rotated": 0x5865f2,
}

function buildEmbed(event: NotificationEvent, payload: NotificationPayload) {
  const fields = []

  if (payload.appName) {
    fields.push({ name: "App", value: payload.appName, inline: true })
  }
  if (payload.commitSha) {
    fields.push({ name: "SHA", value: payload.commitSha.slice(0, 8), inline: true })
  }
  if (payload.durationMs != null) {
    fields.push({ name: "Durée", value: `${Math.round(payload.durationMs / 1000)}s`, inline: true })
  }
  if (payload.errorMessage) {
    fields.push({ name: "Erreur", value: payload.errorMessage.slice(0, 500) })
  }
  if (payload.appDomain) {
    fields.push({ name: "URL", value: `https://${payload.appDomain}` })
  }

  return {
    title: event,
    color: EVENT_COLORS[event] ?? 0x99aab5,
    fields,
    timestamp: new Date().toISOString(),
  }
}

type FetchFn = typeof fetch

export function createDiscordAdapter(fetchFn: FetchFn = fetch): NotificationAdapter {
  return {
    async send(channel: ChannelRow, event: NotificationEvent, payload: NotificationPayload) {
      const parsed = DiscordConfigSchema.safeParse(channel.config)
      if (!parsed.success) {
        return { ok: false, reason: "invalid discord config" }
      }
      const { webhook_url } = parsed.data

      try {
        const res = await fetchFn(webhook_url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ embeds: [buildEmbed(event, payload)] }),
          signal: AbortSignal.timeout(5000),
        })
        if (!res.ok) {
          const text = await res.text().catch(() => "")
          log.warn({ status: res.status, channelId: channel.id }, `Discord webhook returned ${res.status}: ${text}`)
          return { ok: false, reason: `HTTP ${res.status}` }
        }
        return { ok: true }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        log.warn({ err, channelId: channel.id }, "Discord webhook fetch failed")
        return { ok: false, reason }
      }
    },
  }
}

export const discordAdapter: NotificationAdapter = createDiscordAdapter()
