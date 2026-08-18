// SPDX-License-Identifier: AGPL-3.0-only
import { Hono } from "hono"
import type { Db } from "@ploydok/db"
import { stripeClient } from "../billing/stripe"
import {
  claimStripeWebhookEvent,
  completeStripeWebhookEvent,
  releaseStripeWebhookEvent,
} from "../billing/stripe-webhook-replay"
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

    let event: Awaited<ReturnType<typeof stripeClient.verifyWebhookSignature>>
    try {
      event = await stripeClient.verifyWebhookSignature(body, signature)
    } catch (error) {
      log.warn(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Webhook signature verification failed"
      )
      return c.json({ error: "Invalid signature" }, { status: 400 })
    }

    let claim
    try {
      claim = await claimStripeWebhookEvent(db, event)
    } catch (error) {
      log.error(
        { eventId: event.id, error },
        "Failed to claim Stripe webhook event"
      )
      return c.json(
        { error: "Webhook processing unavailable" },
        { status: 503 }
      )
    }

    if (claim.status === "processed") {
      return c.json({ received: true, replayed: true }, { status: 200 })
    }
    if (claim.status === "busy") {
      return c.json(
        { error: "Webhook event already processing" },
        { status: 409 }
      )
    }

    try {
      await stripeClient.syncSubscriptionFromWebhook(db, event)
      const completed = await completeStripeWebhookEvent(
        db,
        event.id,
        claim.leaseToken
      )
      if (!completed) {
        throw new Error("Stripe webhook lease lost before completion")
      }
      return c.json({ received: true }, { status: 200 })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"
      try {
        await releaseStripeWebhookEvent(db, event.id, claim.leaseToken, message)
      } catch (releaseError) {
        log.error(
          { eventId: event.id, error: releaseError },
          "Failed to release Stripe webhook claim"
        )
      }
      log.error(
        { eventId: event.id, error: message },
        "Stripe webhook processing failed"
      )
      return c.json({ error: "Webhook processing failed" }, { status: 500 })
    }
  })

  return router
}
