// SPDX-License-Identifier: AGPL-3.0-only
// TODO: implement WhatsApp adapter via Twilio or Meta Cloud API
import type { NotificationAdapter } from "./types"

export const whatsappAdapter: NotificationAdapter = {
  async send(_channel, _event, _payload) {
    return { ok: false, reason: "coming_soon" }
  },
}
