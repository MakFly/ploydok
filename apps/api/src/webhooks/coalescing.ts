// SPDX-License-Identifier: AGPL-3.0-only
import { nanoid } from "nanoid"

export interface CoalesceJobIdOptions {
  coalesce: boolean
  appId: string
  branch: string
  /** current BullMQ job state — undefined means no existing job */
  existingJobState?: string | undefined
  /** delivery count for the app — used to build suffix when slot is active */
  deliveryCount?: number | undefined
}

export type DropReason =
  | "superseded_waiting"
  | "stale_completed"
  | "stale_failed"

export interface CoalesceJobIdResult {
  jobId: string
  /** true when an existing job (any state) must be removed before re-adding */
  shouldDropExisting: boolean
  /**
   * Why we are dropping the existing job. Caller uses this to distinguish
   * a real coalescing event (mark delivery coalesced, audit) from a silent
   * cleanup of a stale completed/failed job (which is just a Redis hygiene
   * step, not a user-visible coalescing).
   */
  dropReason?: DropReason
}

/**
 * Decides the BullMQ jobId to use for a new deploy job.
 *
 * Rules:
 * - coalesce=false → random nanoid (no deduplication, no drop)
 * - coalesce=true, no existing job → deterministic key
 * - coalesce=true, existing waiting/delayed → reuse key + drop (real coalescing)
 * - coalesce=true, existing active → suffix with delivery count, no drop
 * - coalesce=true, existing completed/failed → reuse key + drop (stale cleanup)
 *
 * Why drop completed/failed: BullMQ refuses to re-add a job whose ID already
 * exists in any state. After a successful deploy, the completed jobId stays
 * in Redis (kept by removeOnComplete:100) and silently swallows new pushes.
 *
 * BullMQ Custom Id constraint: cannot contain ':'. The active-suffix uses
 * '_' to satisfy that.
 */
export function resolveCoalesceJobId(
  opts: CoalesceJobIdOptions
): CoalesceJobIdResult {
  if (!opts.coalesce) {
    return { jobId: nanoid(), shouldDropExisting: false }
  }

  const baseKey = `deploy:${opts.appId}:${opts.branch}`

  if (!opts.existingJobState) {
    return { jobId: baseKey, shouldDropExisting: false }
  }

  if (opts.existingJobState === "waiting" || opts.existingJobState === "delayed") {
    return {
      jobId: baseKey,
      shouldDropExisting: true,
      dropReason: "superseded_waiting",
    }
  }

  if (opts.existingJobState === "active") {
    const n = opts.deliveryCount ?? 0
    return { jobId: `${baseKey}_r${n}`, shouldDropExisting: false }
  }

  if (opts.existingJobState === "completed") {
    return {
      jobId: baseKey,
      shouldDropExisting: true,
      dropReason: "stale_completed",
    }
  }

  if (opts.existingJobState === "failed") {
    return {
      jobId: baseKey,
      shouldDropExisting: true,
      dropReason: "stale_failed",
    }
  }

  // Unknown state (e.g. "stuck", "paused") — be conservative: reuse key
  // and request a drop so we never end up wedged on an unhandled state.
  return {
    jobId: baseKey,
    shouldDropExisting: true,
    dropReason: "stale_completed",
  }
}
