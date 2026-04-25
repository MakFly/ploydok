// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from "bun:test"

describe("event-webhooks queries", () => {
  it("should export query functions", async () => {
    const {
      listEventWebhooks,
      getEventWebhook,
      createEventWebhook,
      updateEventWebhook,
      deleteEventWebhook,
      listEnabledWebhooksForEvent,
    } = await import("./event-webhooks")

    expect(typeof listEventWebhooks).toBe("function")
    expect(typeof getEventWebhook).toBe("function")
    expect(typeof createEventWebhook).toBe("function")
    expect(typeof updateEventWebhook).toBe("function")
    expect(typeof deleteEventWebhook).toBe("function")
    expect(typeof listEnabledWebhooksForEvent).toBe("function")
  })
})
