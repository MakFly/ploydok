// SPDX-License-Identifier: AGPL-3.0-only
import { and, eq, inArray, sql } from "drizzle-orm"
import type { Db } from "@ploydok/db"

export async function claimQueuedRow<TRow>(opts: {
  db: Db
  table: any
  id: string
  expectedStatuses?: Array<string>
  setClaimedAt?: boolean
}): Promise<TRow | null> {
  const statuses = opts.expectedStatuses ?? ["pending"]
  const setClaimedAt = opts.setClaimedAt !== false

  const updatePayload: Record<string, any> = {
    status: "running",
  }

  if (setClaimedAt) {
    updatePayload.claimed_at = sql`NOW()`
  }

  const result = await opts.db
    .update(opts.table)
    .set(updatePayload)
    .where(
      and(eq(opts.table.id, opts.id), inArray(opts.table.status, statuses))
    )
    .returning()

  return result.length > 0 ? (result[0] as TRow) : null
}
