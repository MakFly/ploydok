// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeEach, describe, expect, it, spyOn } from "bun:test"
import * as apiModule from "../../lib/api"
import { listDeliveries, mapDelivery } from "../../lib/webhooks"

const apiFetchMock = spyOn(apiModule, "apiFetch")

afterAll(() => {
  apiFetchMock.mockRestore()
})

describe("listDeliveries", () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
  })

  it("maps snake_case delivery fields and pagination cursor", async () => {
    const rawPage = {
      deliveries: [
        {
          id: "delivery-1",
          app_id: "app-1",
          provider: "github",
          delivery_external_id: "github-delivery-1",
          event: "push",
          ref: "refs/heads/main",
          commit_sha: "abc123",
          commit_message: "deploy from webhook",
          signature_valid: true,
          decision: "skipped_branch",
          decision_reason: "branch filter did not match",
          build_id: "build-1",
          payload_sample: { ref: "refs/heads/main" },
          source: "webhook",
          retry_count: 2,
          parent_delivery_id: "delivery-parent",
          received_at: "2026-05-10T08:00:00.000Z",
          processed_at: "2026-05-10T08:00:01.000Z",
        },
      ],
      next_cursor: "2026-05-10T08:00:00.000Z",
    }
    apiFetchMock.mockImplementation(
      <T>(): Promise<T> => Promise.resolve(rawPage as T)
    )

    const page = await listDeliveries("app-1", "cursor/1")

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/apps/app-1/webhook-deliveries?cursor=cursor%2F1"
    )
    expect(page.nextCursor).toBe("2026-05-10T08:00:00.000Z")
    expect(page.deliveries[0]).toMatchObject({
      appId: "app-1",
      deliveryExternalId: "github-delivery-1",
      commitSha: "abc123",
      commitMessage: "deploy from webhook",
      signatureValid: true,
      decisionReason: "branch filter did not match",
      buildId: "build-1",
      payloadSample: { ref: "refs/heads/main" },
      retryCount: 2,
      parentDeliveryId: "delivery-parent",
      receivedAt: "2026-05-10T08:00:00.000Z",
      processedAt: "2026-05-10T08:00:01.000Z",
    })
  })
})

describe("mapDelivery", () => {
  it("preserves null snake_case fields as nullable camelCase fields", () => {
    const delivery = mapDelivery({
      id: "delivery-2",
      app_id: null,
      provider: "gitlab",
      delivery_external_id: null,
      event: "push",
      ref: null,
      commit_sha: null,
      commit_message: null,
      signature_valid: false,
      decision: "invalid_signature",
      decision_reason: null,
      build_id: null,
      source: "replay",
      retry_count: 0,
      received_at: "2026-05-10T08:00:00.000Z",
      processed_at: null,
      parent_delivery_id: null,
    })

    expect(delivery.appId).toBeNull()
    expect(delivery.deliveryExternalId).toBeNull()
    expect(delivery.decisionReason).toBeNull()
    expect(delivery.buildId).toBeNull()
    expect(delivery.processedAt).toBeNull()
  })
})
