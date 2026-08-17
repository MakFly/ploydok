// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tests for use-pending-action.ts — the React-free timing core.
 */
import { describe, expect, it, mock } from "bun:test"
import { runPendingAction } from "../../../lib/hooks/use-pending-action"

describe("runPendingAction", () => {
  it("floors a fast action to minVisibleMs", async () => {
    const start = Date.now()
    const result = await runPendingAction(() => Promise.resolve("ok"), {
      minVisibleMs: 60,
    })

    expect(result).toBe("ok")
    expect(Date.now() - start).toBeGreaterThanOrEqual(55)
  })

  it("adds nothing when the action is already slower than the floor", async () => {
    const slow = (): Promise<string> =>
      new Promise((resolve) => setTimeout(() => resolve("ok"), 80))
    const start = Date.now()
    await runPendingAction(slow, { minVisibleMs: 20 })

    expect(Date.now() - start).toBeLessThan(160)
  })

  it("rejects immediately on error, without waiting out the floor", async () => {
    const start = Date.now()
    await expect(
      runPendingAction(() => Promise.reject(new Error("boom")), {
        minVisibleMs: 2_000,
      })
    ).rejects.toThrow("boom")

    expect(Date.now() - start).toBeLessThan(500)
  })

  it("reports to onError and still rethrows", async () => {
    const onError = mock(() => {})
    await expect(
      runPendingAction(() => Promise.reject(new Error("nope")), {
        minVisibleMs: 10,
        onError,
      })
    ).rejects.toThrow("nope")

    expect(onError).toHaveBeenCalledTimes(1)
  })

  it("passes the resolved value through untouched", async () => {
    const value = { id: 42 }
    const result = await runPendingAction(() => Promise.resolve(value), {
      minVisibleMs: 1,
    })

    expect(result).toBe(value)
  })
})
