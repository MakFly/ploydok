// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, mock } from "bun:test"

const verifyWebhookSignatureMock = mock(async () => ({
  id: "evt_test",
  type: "customer.subscription.updated",
}))
const syncSubscriptionFromWebhookMock = mock(async () => undefined)
type ClaimResult =
  | { status: "claimed"; leaseToken: string }
  | { status: "processed" }
  | { status: "busy" }

const claimStripeWebhookEventMock = mock(
  async (): Promise<ClaimResult> => ({
    status: "claimed",
    leaseToken: "lease-test",
  })
)
const completeStripeWebhookEventMock = mock(async () => true)
const releaseStripeWebhookEventMock = mock(async () => true)

mock.module("../billing/stripe", () => ({
  stripeClient: {
    verifyWebhookSignature: verifyWebhookSignatureMock,
    syncSubscriptionFromWebhook: syncSubscriptionFromWebhookMock,
    isConfigured: () => true,
  },
}))

mock.module("../billing/stripe-webhook-replay", () => ({
  claimStripeWebhookEvent: claimStripeWebhookEventMock,
  completeStripeWebhookEvent: completeStripeWebhookEventMock,
  releaseStripeWebhookEvent: releaseStripeWebhookEventMock,
}))

const { app } = await import("../app")

beforeEach(() => {
  verifyWebhookSignatureMock.mockClear()
  verifyWebhookSignatureMock.mockResolvedValue({
    id: "evt_test",
    type: "customer.subscription.updated",
  })
  syncSubscriptionFromWebhookMock.mockClear()
  syncSubscriptionFromWebhookMock.mockResolvedValue(undefined)
  claimStripeWebhookEventMock.mockClear()
  claimStripeWebhookEventMock.mockResolvedValue({
    status: "claimed",
    leaseToken: "lease-test",
  })
  completeStripeWebhookEventMock.mockClear()
  completeStripeWebhookEventMock.mockResolvedValue(true)
  releaseStripeWebhookEventMock.mockClear()
  releaseStripeWebhookEventMock.mockResolvedValue(true)
})

describe("Stripe webhook CSRF and signature boundary", () => {
  it("lets the exact signed POST /stripe endpoint bypass browser CSRF", async () => {
    const res = await app.request("/stripe", {
      method: "POST",
      headers: { "stripe-signature": "valid-signature" },
      body: "raw-stripe-payload",
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true })
    expect(verifyWebhookSignatureMock).toHaveBeenCalledWith(
      "raw-stripe-payload",
      "valid-signature"
    )
    expect(syncSubscriptionFromWebhookMock).toHaveBeenCalledTimes(1)
    expect(completeStripeWebhookEventMock).toHaveBeenCalledWith(
      expect.anything(),
      "evt_test",
      "lease-test"
    )
  })

  it("acknowledges a completed replay without applying billing twice", async () => {
    claimStripeWebhookEventMock.mockResolvedValueOnce({ status: "processed" })

    const res = await app.request("/stripe", {
      method: "POST",
      headers: { "stripe-signature": "valid-signature" },
      body: "raw-stripe-payload",
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true, replayed: true })
    expect(syncSubscriptionFromWebhookMock).not.toHaveBeenCalled()
    expect(completeStripeWebhookEventMock).not.toHaveBeenCalled()
  })

  it("returns a retryable conflict while the event is leased", async () => {
    claimStripeWebhookEventMock.mockResolvedValueOnce({ status: "busy" })

    const res = await app.request("/stripe", {
      method: "POST",
      headers: { "stripe-signature": "valid-signature" },
      body: "raw-stripe-payload",
    })

    expect(res.status).toBe(409)
    expect(syncSubscriptionFromWebhookMock).not.toHaveBeenCalled()
  })

  it("returns 5xx and releases the lease after a processing failure", async () => {
    syncSubscriptionFromWebhookMock.mockRejectedValueOnce(
      new Error("database unavailable")
    )

    const res = await app.request("/stripe", {
      method: "POST",
      headers: { "stripe-signature": "valid-signature" },
      body: "raw-stripe-payload",
    })

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: "Webhook processing failed" })
    expect(releaseStripeWebhookEventMock).toHaveBeenCalledWith(
      expect.anything(),
      "evt_test",
      "lease-test",
      "database unavailable"
    )
    expect(completeStripeWebhookEventMock).not.toHaveBeenCalled()
  })

  it("still rejects a missing Stripe signature after the CSRF exemption", async () => {
    const res = await app.request("/stripe", {
      method: "POST",
      body: "raw-stripe-payload",
    })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "Missing signature" })
    expect(verifyWebhookSignatureMock).not.toHaveBeenCalled()
    expect(syncSubscriptionFromWebhookMock).not.toHaveBeenCalled()
  })

  it("rejects an invalid signature and never synchronizes billing", async () => {
    verifyWebhookSignatureMock.mockRejectedValueOnce(new Error("bad signature"))

    const res = await app.request("/stripe", {
      method: "POST",
      headers: { "stripe-signature": "invalid-signature" },
      body: "tampered-payload",
    })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "Invalid signature" })
    expect(syncSubscriptionFromWebhookMock).not.toHaveBeenCalled()
  })

  it("does not exempt sibling Stripe paths from CSRF", async () => {
    const res = await app.request("/stripe/replay", {
      method: "POST",
      headers: { "stripe-signature": "valid-signature" },
      body: "raw-stripe-payload",
    })

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({
      error: { code: "CSRF_MISMATCH" },
    })
    expect(verifyWebhookSignatureMock).not.toHaveBeenCalled()
  })
})
