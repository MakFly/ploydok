// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Unit tests for handleDeleteApp (Wave 2 DB-anchored queue).
 *
 * Tests schema validation and graceful error handling.
 */
import { describe, it, expect } from "bun:test"

describe("handleDeleteApp", () => {
  it("validates payload schema — throws on invalid JSON", async () => {
    const { handleDeleteApp } = await import("./delete-app")
    const fakeDb = {} as import("@ploydok/db").Db
    const job = {
      id: "job-invalid",
      payload: "{invalid json}",
    }

    await expect(handleDeleteApp(fakeDb, job)).rejects.toThrow()
  })
})
