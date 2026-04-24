// SPDX-License-Identifier: AGPL-3.0-only
import { and, desc, eq, sql } from "drizzle-orm"
import { audit_log } from "../schema"
import type { Db } from "../client"

export type AuditLogRow = typeof audit_log.$inferSelect

/**
 * Lists audit events for a given organization, ordered by created_at descending.
 * Supports cursor-based pagination (cursor = id of last seen row).
 */
export async function listAuditEventsForOrg(
  db: Db,
  orgId: string,
  opts: {
    limit?: number
    cursor?: number
    actionPrefix?: string
    targetType?: string
  } = {}
): Promise<{
  events: AuditLogRow[]
  nextCursor: number | null
}> {
  const { limit = 50, cursor, actionPrefix, targetType } = opts

  const conditions = [eq(audit_log.org_id, orgId)]

  if (actionPrefix) {
    conditions.push(sql`${audit_log.action} ILIKE ${actionPrefix}%`)
  }

  if (targetType) {
    conditions.push(eq(audit_log.target_type, targetType))
  }

  if (cursor) {
    conditions.push(sql`${audit_log.id} < ${cursor}`)
  }

  const rows = await db
    .select()
    .from(audit_log)
    .where(and(...conditions))
    .orderBy(desc(audit_log.id))
    .limit(limit + 1)

  const events = rows.slice(0, limit)
  const nextCursor =
    rows.length > limit ? (events[events.length - 1]?.id ?? null) : null

  return { events, nextCursor }
}

/**
 * Lists audit events for a given user across all orgs, ordered by created_at descending.
 */
export async function listAuditEventsForUser(
  db: Db,
  userId: string,
  opts: {
    limit?: number
    cursor?: number
    actionPrefix?: string
    targetType?: string
  } = {}
): Promise<{
  events: AuditLogRow[]
  nextCursor: number | null
}> {
  const { limit = 50, cursor, actionPrefix, targetType } = opts

  const conditions = [eq(audit_log.user_id, userId)]

  if (actionPrefix) {
    conditions.push(sql`${audit_log.action} ILIKE ${actionPrefix}%`)
  }

  if (targetType) {
    conditions.push(eq(audit_log.target_type, targetType))
  }

  if (cursor) {
    conditions.push(sql`${audit_log.id} < ${cursor}`)
  }

  const rows = await db
    .select()
    .from(audit_log)
    .where(and(...conditions))
    .orderBy(desc(audit_log.id))
    .limit(limit + 1)

  const events = rows.slice(0, limit)
  const nextCursor =
    rows.length > limit ? (events[events.length - 1]?.id ?? null) : null

  return { events, nextCursor }
}
