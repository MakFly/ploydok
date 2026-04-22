// SPDX-License-Identifier: AGPL-3.0-only
import { EmailConfigSchema } from "@ploydok/shared"
import type { NotificationEvent } from "@ploydok/shared"
import type { NotificationAdapter, ChannelRow, NotificationPayload } from "./types"
import { sendMail } from "../mailer"
import { childLogger } from "../logger"

const log = childLogger("notify.email")

function renderHtml(event: NotificationEvent, payload: NotificationPayload): string {
  const rows: string[] = []
  if (payload.appName) rows.push(`<tr><td><b>App</b></td><td>${payload.appName}</td></tr>`)
  if (payload.commitSha) rows.push(`<tr><td><b>SHA</b></td><td>${payload.commitSha.slice(0, 8)}</td></tr>`)
  if (payload.durationMs != null) rows.push(`<tr><td><b>Durée</b></td><td>${Math.round(payload.durationMs / 1000)}s</td></tr>`)
  if (payload.errorMessage) rows.push(`<tr><td><b>Erreur</b></td><td>${payload.errorMessage.slice(0, 500)}</td></tr>`)
  if (payload.appDomain) rows.push(`<tr><td><b>URL</b></td><td><a href="https://${payload.appDomain}">${payload.appDomain}</a></td></tr>`)

  return `<html><body>
<h2>[Ploydok] ${event}</h2>
<table border="0" cellpadding="6">${rows.join("")}</table>
</body></html>`
}

export const emailAdapter: NotificationAdapter = {
  async send(channel: ChannelRow, event: NotificationEvent, payload: NotificationPayload) {
    const parsed = EmailConfigSchema.safeParse(channel.config)
    if (!parsed.success) {
      return { ok: false, reason: "invalid email config" }
    }
    const { to } = parsed.data

    try {
      await sendMail({
        to,
        subject: `[Ploydok] ${event} — ${payload.appName}`,
        text: `Event: ${event}\nApp: ${payload.appName}\nSHA: ${payload.commitSha ?? "N/A"}\nDurée: ${payload.durationMs != null ? `${Math.round(payload.durationMs / 1000)}s` : "N/A"}`,
        html: renderHtml(event, payload),
      })
      return { ok: true }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      log.warn({ err, channelId: channel.id }, "email notify failed")
      return { ok: false, reason }
    }
  },
}
