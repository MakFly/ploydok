// SPDX-License-Identifier: AGPL-3.0-only
import { SlackConfigSchema } from "@ploydok/shared"
import type { NotificationEvent } from "@ploydok/shared"
import type { NotificationAdapter, ChannelRow, NotificationPayload } from "./types"
import { childLogger } from "../logger"

const log = childLogger("notify.slack")

function buildBlocks(event: NotificationEvent, payload: NotificationPayload) {
  const lines: string[] = []
  if (payload.appName) lines.push(`*App:* ${payload.appName}`)
  if (payload.commitSha) lines.push(`*SHA:* ${payload.commitSha.slice(0, 8)}`)
  if (payload.durationMs != null) lines.push(`*Durée:* ${Math.round(payload.durationMs / 1000)}s`)
  if (payload.errorMessage) lines.push(`*Erreur:* ${payload.errorMessage.slice(0, 500)}`)

  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: event, emoji: true },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: lines.join("\n") || "_No details_" },
    },
  ]

  if (payload.appDomain && payload.buildId) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Voir les logs" },
          url: `https://${payload.appDomain}`,
          action_id: "view_logs",
        },
      ],
    })
  }

  return blocks
}

export const slackAdapter: NotificationAdapter = {
  async send(channel: ChannelRow, event: NotificationEvent, payload: NotificationPayload) {
    const parsed = SlackConfigSchema.safeParse(channel.config)
    if (!parsed.success) {
      return { ok: false, reason: "invalid slack config" }
    }
    const { webhook_url } = parsed.data

    try {
      const res = await fetch(webhook_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocks: buildBlocks(event, payload) }),
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => "")
        log.warn({ status: res.status, channelId: channel.id }, `Slack webhook returned ${res.status}: ${text}`)
        return { ok: false, reason: `HTTP ${res.status}` }
      }
      return { ok: true }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      log.warn({ err, channelId: channel.id }, "Slack webhook fetch failed")
      return { ok: false, reason }
    }
  },
}
