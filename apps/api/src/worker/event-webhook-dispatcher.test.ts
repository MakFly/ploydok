// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from "bun:test"

describe("event-webhook-dispatcher", () => {
  it("should export dispatchEvent function", async () => {
    const { dispatchEvent } = await import("./event-webhook-dispatcher")
    expect(typeof dispatchEvent).toBe("function")
  })
})
