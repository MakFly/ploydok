// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, mock } from "bun:test"

interface EnabledWebhookFixture {
  id: string
  org_id: string
  url: string
  secret_enc: Buffer | null
  secret_nonce: Buffer | null
}

const listEnabledWebhooksForEventMock = mock(
  async (): Promise<EnabledWebhookFixture[]> => [],
)
const updateEventWebhookMock = mock(async () => null)

mock.module("@ploydok/db/queries", () => ({
  getAppForUser: mock(async () => null),
  listEnabledWebhooksForEvent: listEnabledWebhooksForEventMock,
  updateEventWebhook: updateEventWebhookMock,
  getMembership: mock(async () => null),
  isOrgOwner: mock(async () => false),
  listEventWebhooks: mock(async () => []),
  getEventWebhook: mock(async () => null),
  createEventWebhook: mock(async () => null),
  deleteEventWebhook: mock(async () => false),
}))

const lookupMock = mock(async () => [{ address: "10.0.0.8", family: 4 }])

mock.module("node:dns/promises", () => ({
  lookup: lookupMock,
}))

mock.module("../github/app-credentials", () => ({
  decryptField: mock(async () => "secret"),
  encryptField: mock(async () => ({
    enc: Buffer.from("enc"),
    nonce: Buffer.from("nonce"),
  })),
}))

describe("event-webhook-dispatcher", () => {
  it("should export dispatchEvent function", async () => {
    const { dispatchEvent } = await import("./event-webhook-dispatcher")
    expect(typeof dispatchEvent).toBe("function")
  })

  it("refuses dispatch when DNS resolves the webhook host to a private IP", async () => {
    listEnabledWebhooksForEventMock.mockResolvedValueOnce([
      {
        id: "wh-1",
        org_id: "org-1",
        url: "https://webhook.example.test/hook",
        secret_enc: null,
        secret_nonce: null,
      },
    ])

    const { dispatchEvent } = await import("./event-webhook-dispatcher")
    await dispatchEvent({} as never, {
      orgId: "org-1",
      orgSlug: "org",
      event: "deploy.succeeded",
      data: {},
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(lookupMock).toHaveBeenCalledWith("webhook.example.test", {
      all: true,
      verbatim: true,
    })
    expect(updateEventWebhookMock).toHaveBeenCalledWith(
      {},
      "wh-1",
      "org-1",
      expect.objectContaining({
        last_error: "Webhook URL resolves to a blocked private address",
      }),
    )
  })
})
