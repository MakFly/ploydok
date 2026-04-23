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

export interface CoalesceJobIdResult {
  jobId: string
  /** true when a waiting/delayed job was superseded and must be removed */
  shouldDropExisting: boolean
}

/**
 * Decides the BullMQ jobId to use for a new deploy job.
 *
 * Rules:
 * - coalesce=false → random nanoid (no deduplication)
 * - coalesce=true, no existing job → deterministic key `deploy:<appId>:<branch>`
 * - coalesce=true, existing job waiting/delayed → reuse same key (caller must remove old job)
 * - coalesce=true, existing job active → suffix with delivery count to avoid collision
 */
export function resolveCoalesceJobId(opts: CoalesceJobIdOptions): CoalesceJobIdResult {
  if (!opts.coalesce) {
    return { jobId: nanoid(), shouldDropExisting: false }
  }

  const baseKey = `deploy:${opts.appId}:${opts.branch}`

  if (!opts.existingJobState) {
    return { jobId: baseKey, shouldDropExisting: false }
  }

  if (opts.existingJobState === "waiting" || opts.existingJobState === "delayed") {
    return { jobId: baseKey, shouldDropExisting: true }
  }

  if (opts.existingJobState === "active") {
    const n = opts.deliveryCount ?? 0
    return { jobId: `${baseKey}:r${n}`, shouldDropExisting: false }
  }

  return { jobId: baseKey, shouldDropExisting: false }
}
