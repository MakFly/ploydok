// SPDX-License-Identifier: AGPL-3.0-only
import type { Db } from "@ploydok/db"
import { dispatchEvent } from "./event-webhook-dispatcher"
import type { EventBus } from "./event-bus"

const eventTypeToWebhookEvent: Record<string, string> = {
  "build.started": "deploy.started",
  "build.succeeded": "deploy.succeeded",
  "build.failed": "deploy.failed",
}

export async function registerWebhookSubscriber(
  eventBus: EventBus,
  db: Db,
  getOrgIdForApp: (appId: string) => Promise<string | null>,
  getOrgSlugById: (orgId: string) => Promise<string | null>
): Promise<() => void> {
  const unsub = eventBus.subscribe("system:events", async (event) => {
    const webhookEventType = eventTypeToWebhookEvent[event.type]
    if (!webhookEventType || !event.appId) return

    try {
      const orgId = await getOrgIdForApp(event.appId)
      if (!orgId) return

      const orgSlug = await getOrgSlugById(orgId)
      if (!orgSlug) return

      await dispatchEvent(db, {
        orgId,
        orgSlug,
        event: webhookEventType,
        data: {
          appId: event.appId,
          buildId: event.buildId,
          message: event.message,
        },
      })
    } catch (error) {
      // Silently handle errors
    }
  })

  return unsub
}
