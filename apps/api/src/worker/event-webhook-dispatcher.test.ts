// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, mock } from "bun:test"

mock.module("@ploydok/db/queries", () => ({
  getAppForUser: mock(async () => null),
  listEnabledWebhooksForEvent: mock(async () => []),
  updateEventWebhook: mock(async () => null),
  getMembership: mock(async () => null),
  listEventWebhooks: mock(async () => []),
  getEventWebhook: mock(async () => null),
  createEventWebhook: mock(async () => null),
  deleteEventWebhook: mock(async () => false),
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
})
