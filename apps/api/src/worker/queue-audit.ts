// SPDX-License-Identifier: AGPL-3.0-only
import { childLogger } from "../logger"

export const queueAudit = childLogger("queue.audit")

export function auditEnqueued(opts: {
  jobName: string
  jobId: string
  rowId: string
  actor: string | null
  source: string
}): void {
  queueAudit.info(
    {
      event: "enqueued",
      jobName: opts.jobName,
      jobId: opts.jobId,
      rowId: opts.rowId,
      actor: opts.actor,
      source: opts.source,
    },
    `Job enqueued: ${opts.jobName} (${opts.jobId})`
  )
}

export function auditClaimed(opts: {
  jobName: string
  jobId: string
  rowId: string
  actor: string | null
  source: string
}): void {
  queueAudit.info(
    {
      event: "claimed",
      jobName: opts.jobName,
      jobId: opts.jobId,
      rowId: opts.rowId,
      actor: opts.actor,
      source: opts.source,
    },
    `Job claimed: ${opts.jobName} (${opts.jobId})`
  )
}

export function auditUnauthorized(opts: {
  jobName: string
  jobId: string
  payload: unknown
  reason: string
}): void {
  queueAudit.warn(
    {
      event: "unauthorized",
      jobName: opts.jobName,
      jobId: opts.jobId,
      reason: opts.reason,
      payload: opts.payload,
    },
    `Unauthorized job execution: ${opts.jobName} (${opts.jobId})`
  )
}

export function auditDuplicateClaim(opts: {
  jobName: string
  jobId: string
  rowId: string
}): void {
  queueAudit.warn(
    {
      event: "duplicate_claim",
      jobName: opts.jobName,
      jobId: opts.jobId,
      rowId: opts.rowId,
    },
    `Duplicate claim attempt: ${opts.jobName} (${opts.jobId})`
  )
}
