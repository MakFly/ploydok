// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from "bun:test"
import { createStripeWebhookRouter } from "./webhooks-stripe"

describe("Stripe Webhook Router", () => {
  it("createStripeWebhookRouter returns a router", () => {
    expect(createStripeWebhookRouter).toBeDefined()
  })
})
