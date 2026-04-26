// SPDX-License-Identifier: AGPL-3.0-only
import type { Queue, JobsOptions } from "bullmq"
import type { Db } from "@ploydok/db"
import { auditEnqueued } from "./queue-audit"

export async function enqueueWithDbRow<
  TPayload,
  TRow extends { id: string },
>(opts: {
  db: Db
  queue: Queue
  jobName: string
  insertRow: (txDb: any) => Promise<TRow>
  buildPayload: (row: TRow) => TPayload
  jobOptions?: JobsOptions
}): Promise<{ jobId: string; row: TRow }> {
  let row: TRow
  let job: Awaited<ReturnType<Queue["add"]>>

  await opts.db.transaction(async (tx) => {
    row = await opts.insertRow(tx as any)
    job = await opts.queue.add(
      opts.jobName,
      opts.buildPayload(row),
      opts.jobOptions
    )
  })

  const jobId = job!.id
  if (!jobId) {
    throw new Error(`Failed to get job ID from queue.add(${opts.jobName})`)
  }

  const actor = (row! as any)?.requested_by_user_id ?? null
  const source = (row! as any)?.source ?? "system"

  auditEnqueued({
    jobName: opts.jobName,
    jobId,
    rowId: row!.id,
    actor,
    source,
  })

  return {
    jobId,
    row: row!,
  }
}
