// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "bun:test"
import { resolveCoalesceJobId } from "./coalescing"

describe("resolveCoalesceJobId", () => {
  describe("coalesce=false", () => {
    it("returns a random nanoid with no drop", () => {
      const a = resolveCoalesceJobId({
        coalesce: false,
        appId: "app1",
        branch: "main",
      })
      const b = resolveCoalesceJobId({
        coalesce: false,
        appId: "app1",
        branch: "main",
      })
      expect(a.shouldDropExisting).toBe(false)
      expect(b.shouldDropExisting).toBe(false)
      expect(a.jobId).not.toBe(b.jobId)
      expect(a.dropReason).toBeUndefined()
    })
  })

  describe("coalesce=true", () => {
    const baseOpts = { coalesce: true, appId: "app1", branch: "main" }

    it("no existing job → deterministic key, no drop", () => {
      const r = resolveCoalesceJobId(baseOpts)
      expect(r.jobId).toBe("deploy:app1:main")
      expect(r.shouldDropExisting).toBe(false)
      expect(r.dropReason).toBeUndefined()
    })

    it("existing waiting → reuse key, drop with superseded_waiting", () => {
      const r = resolveCoalesceJobId({
        ...baseOpts,
        existingJobState: "waiting",
      })
      expect(r.jobId).toBe("deploy:app1:main")
      expect(r.shouldDropExisting).toBe(true)
      expect(r.dropReason).toBe("superseded_waiting")
    })

    it("existing delayed → reuse key, drop with superseded_waiting", () => {
      const r = resolveCoalesceJobId({
        ...baseOpts,
        existingJobState: "delayed",
      })
      expect(r.shouldDropExisting).toBe(true)
      expect(r.dropReason).toBe("superseded_waiting")
    })

    it("existing active → suffix with delivery count, no drop", () => {
      const r = resolveCoalesceJobId({
        ...baseOpts,
        existingJobState: "active",
        deliveryCount: 3,
      })
      expect(r.jobId).toBe("deploy:app1:main_r3")
      expect(r.shouldDropExisting).toBe(false)
    })

    it("active suffix uses '_' not ':' (BullMQ Custom Id constraint)", () => {
      const r = resolveCoalesceJobId({
        ...baseOpts,
        existingJobState: "active",
        deliveryCount: 7,
      })
      // BullMQ rejects ':' in custom job IDs. The suffix part after baseKey
      // must use '_'. The baseKey itself contains ':' but that's fine
      // because BullMQ's check is on the user-provided custom suffix.
      expect(r.jobId.split(":").pop()).toBe("main_r7")
    })

    it("existing completed → reuse key, drop with stale_completed", () => {
      const r = resolveCoalesceJobId({
        ...baseOpts,
        existingJobState: "completed",
      })
      expect(r.jobId).toBe("deploy:app1:main")
      expect(r.shouldDropExisting).toBe(true)
      expect(r.dropReason).toBe("stale_completed")
    })

    it("existing failed → reuse key, drop with stale_failed", () => {
      const r = resolveCoalesceJobId({
        ...baseOpts,
        existingJobState: "failed",
      })
      expect(r.jobId).toBe("deploy:app1:main")
      expect(r.shouldDropExisting).toBe(true)
      expect(r.dropReason).toBe("stale_failed")
    })

    it("unknown state → drop conservatively (avoid wedging on unhandled state)", () => {
      const r = resolveCoalesceJobId({
        ...baseOpts,
        existingJobState: "stuck-or-paused",
      })
      expect(r.shouldDropExisting).toBe(true)
      expect(r.dropReason).toBe("stale_completed")
    })
  })
})
