// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, mock } from "bun:test"
import { StripeClient } from "./stripe"

describe("StripeClient", () => {
  it("isConfigured returns false when STRIPE_SECRET_KEY is not set", () => {
    const client = new StripeClient()
    expect(client.isConfigured()).toBe(false)
  })

  it("createCheckoutSession throws when not configured", async () => {
    const client = new StripeClient()
    try {
      await client.createCheckoutSession("org-123", "pro", "http://localhost")
      expect.unreachable()
    } catch (e) {
      expect(e instanceof Error).toBe(true)
      expect((e as Error).message).toContain("not configured")
    }
  })

  it("verifyWebhookSignature throws when not configured", async () => {
    const client = new StripeClient()
    try {
      await client.verifyWebhookSignature("body", "signature")
      expect.unreachable()
    } catch (e) {
      expect(e instanceof Error).toBe(true)
      expect((e as Error).message).toContain("not configured")
    }
  })
})
