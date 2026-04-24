// SPDX-License-Identifier: AGPL-3.0-only
import { Hono } from "hono"
import type { Db } from "@ploydok/db"
import { stripeClient } from "../billing/stripe"
import { childLogger } from "../logger"

const log = childLogger("webhooks.stripe")

export function createStripeWebhookRouter(db: Db) {
  const router = new Hono()

  router.post("/stripe", async (c) => {
    const signature = c.req.header("stripe-signature")

    if (!signature) {
      return c.json({ error: "Missing signature" }, { status: 400 })
    }

    const body = await c.req.text()

    try {
      const event = await stripeClient.verifyWebhookSignature(body, signature)
      await stripeClient.syncSubscriptionFromWebhook(db, event)
      return c.json({ received: true }, { status: 200 })
    } catch (error) {
      log.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Webhook signature verification failed"
      )
      return c.json({ error: "Invalid signature" }, { status: 400 })
    }
  })

  return router
}
