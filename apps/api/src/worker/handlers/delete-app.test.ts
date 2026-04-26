// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Unit tests for handleDeleteApp (Wave 2 DB-anchored queue).
 *
 * Tests the claim logic and error handling for the app.delete.requested job.
 */
import { describe, it, expect, mock, beforeEach } from "bun:test"
import { z } from "zod"

function makeJob(payload: object): { id: string; payload: string } {
  return {
    id: "job-delete-test",
    payload: JSON.stringify(payload),
  }
}

const fakeDb = {} as import("@ploydok/db").Db

describe("handleDeleteApp", () => {
  beforeEach(() => {
    mock.restore()
  })

  it("rejects payload without jobId", async () => {
    const { handleDeleteApp } = await import("./delete-app")
    const job = makeJob({})

    await expect(handleDeleteApp(fakeDb, job)).rejects.toThrow()
  })

  it("rejects payload with non-existent jobId", async () => {
    const { handleDeleteApp } = await import("./delete-app")
    const job = makeJob({ jobId: "nonexistent-delete-job" })

    await expect(handleDeleteApp(fakeDb, job)).rejects.toThrow()
  })
})
