// SPDX-License-Identifier: AGPL-3.0-only
import { and, count, desc, eq, lt, isNotNull } from "drizzle-orm"
import { apps, projects, webhook_deliveries, memberships } from "../schema"
import type { Db } from "../client"

export type DeliveryRow = typeof webhook_deliveries.$inferSelect

// ---------------------------------------------------------------------------
// List deliveries (cursor-based pagination, newest first)
// ---------------------------------------------------------------------------

export interface ListDeliveriesResult {
  deliveries: DeliverySummary[]
  next_cursor: string | null
}

export interface DeliverySummary {
  id: string
  provider: string
  event: string
  ref: string | null
  commit_sha: string | null
  commit_message: string | null
  decision: string
  decision_reason: string | null
  signature_valid: boolean
  build_id: string | null
  received_at: string
  processed_at: string | null
  retry_count: number
  parent_delivery_id: string | null
  source: string
}

// ---------------------------------------------------------------------------
// Push-handler helpers (used by webhook-handlers/push.ts)
// ---------------------------------------------------------------------------

/**
 * Returns the most recent "enqueued" delivery for an app, or null if none.
 * Used by the coalescing path to find the previous job's delivery record.
 */
export async function findRecentEnqueuedDeliveryByApp(
  db: Db,
  appId: string
): Promise<{ id: string } | null> {
  const rows = await db
    .select({ id: webhook_deliveries.id })
    .from(webhook_deliveries)
    .where(
      and(
        eq(webhook_deliveries.app_id, appId),
        eq(webhook_deliveries.decision, "enqueued")
      )
    )
    .limit(1)

  return rows[0] ?? null
}

/**
 * Returns the total count of deliveries for an app.
 * Used to generate a unique job-id suffix when the active slot is busy.
 */
export async function countDeliveriesByApp(
  db: Db,
  appId: string
): Promise<number> {
  const rows = await db
    .select({ c: count() })
    .from(webhook_deliveries)
    .where(eq(webhook_deliveries.app_id, appId))

  return Number(rows[0]?.c ?? 0)
}

/**
 * Returns deliveries for an app with cursor-based pagination on received_at DESC.
 * Access is verified via membership — returns null if user lacks access.
 */
export async function listDeliveriesByApp(
  db: Db,
  appId: string,
  userId: string,
  limit: number,
  cursor?: string
): Promise<ListDeliveriesResult | null> {
  // Verify access via membership
  const appRows = await db
    .select({ id: apps.id })
    .from(apps)
    .innerJoin(projects, eq(apps.project_id, projects.id))
    .innerJoin(
      memberships,
      and(
        eq(memberships.org_id, projects.id),
        eq(memberships.user_id, userId),
        isNotNull(memberships.accepted_at)
      )
    )
    .where(eq(apps.id, appId))
    .limit(1)

  if (!appRows[0]) return null

  const cursorDate = cursor ? new Date(cursor) : undefined

  const rows = await db
    .select({
      id: webhook_deliveries.id,
      provider: webhook_deliveries.provider,
      event: webhook_deliveries.event,
      ref: webhook_deliveries.ref,
      commit_sha: webhook_deliveries.commit_sha,
      commit_message: webhook_deliveries.commit_message,
      decision: webhook_deliveries.decision,
      decision_reason: webhook_deliveries.decision_reason,
      signature_valid: webhook_deliveries.signature_valid,
      build_id: webhook_deliveries.build_id,
      received_at: webhook_deliveries.received_at,
      processed_at: webhook_deliveries.processed_at,
      retry_count: webhook_deliveries.retry_count,
      parent_delivery_id: webhook_deliveries.parent_delivery_id,
      source: webhook_deliveries.source,
    })
    .from(webhook_deliveries)
    .where(
      cursorDate
        ? and(
            eq(webhook_deliveries.app_id, appId),
            lt(webhook_deliveries.received_at, cursorDate)
          )
        : eq(webhook_deliveries.app_id, appId)
    )
    .orderBy(desc(webhook_deliveries.received_at))
    .limit(limit + 1)

  const hasMore = rows.length > limit
  const page = rows.slice(0, limit)

  return {
    deliveries: page.map((r) => ({
      id: r.id,
      provider: r.provider,
      event: r.event,
      ref: r.ref,
      commit_sha: r.commit_sha,
      commit_message: r.commit_message,
      decision: r.decision,
      decision_reason: r.decision_reason,
      signature_valid: r.signature_valid,
      build_id: r.build_id,
      received_at:
        r.received_at instanceof Date
          ? r.received_at.toISOString()
          : String(r.received_at),
      processed_at:
        r.processed_at instanceof Date
          ? r.processed_at.toISOString()
          : r.processed_at
            ? String(r.processed_at)
            : null,
      retry_count: r.retry_count,
      parent_delivery_id: r.parent_delivery_id,
      source: r.source,
    })),
    next_cursor:
      hasMore && page[page.length - 1]
        ? page[page.length - 1]!.received_at instanceof Date
          ? (page[page.length - 1]!.received_at as Date).toISOString()
          : String(page[page.length - 1]!.received_at)
        : null,
  }
}

// ---------------------------------------------------------------------------
// Get single delivery (with payload_sample)
// ---------------------------------------------------------------------------

export interface DeliveryDetail extends DeliverySummary {
  payload_sample: unknown
}

/**
 * Returns a single delivery with its payload_sample.
 * Access is verified via membership — returns null if not found or user lacks access.
 */
export async function getDeliveryById(
  db: Db,
  appId: string,
  deliveryId: string,
  userId: string
): Promise<DeliveryDetail | null> {
  // Verify app access via membership
  const appRows = await db
    .select({ id: apps.id })
    .from(apps)
    .innerJoin(projects, eq(apps.project_id, projects.id))
    .innerJoin(
      memberships,
      and(
        eq(memberships.org_id, projects.id),
        eq(memberships.user_id, userId),
        isNotNull(memberships.accepted_at)
      )
    )
    .where(eq(apps.id, appId))
    .limit(1)

  if (!appRows[0]) return null

  const rows = await db
    .select({
      id: webhook_deliveries.id,
      provider: webhook_deliveries.provider,
      event: webhook_deliveries.event,
      ref: webhook_deliveries.ref,
      commit_sha: webhook_deliveries.commit_sha,
      commit_message: webhook_deliveries.commit_message,
      decision: webhook_deliveries.decision,
      decision_reason: webhook_deliveries.decision_reason,
      signature_valid: webhook_deliveries.signature_valid,
      build_id: webhook_deliveries.build_id,
      received_at: webhook_deliveries.received_at,
      processed_at: webhook_deliveries.processed_at,
      retry_count: webhook_deliveries.retry_count,
      parent_delivery_id: webhook_deliveries.parent_delivery_id,
      source: webhook_deliveries.source,
      payload_sample: webhook_deliveries.payload_sample,
    })
    .from(webhook_deliveries)
    .where(
      and(
        eq(webhook_deliveries.id, deliveryId),
        eq(webhook_deliveries.app_id, appId)
      )
    )
    .limit(1)

  const r = rows[0]
  if (!r) return null

  return {
    id: r.id,
    provider: r.provider,
    event: r.event,
    ref: r.ref,
    commit_sha: r.commit_sha,
    commit_message: r.commit_message,
    decision: r.decision,
    decision_reason: r.decision_reason,
    signature_valid: r.signature_valid,
    build_id: r.build_id,
    received_at:
      r.received_at instanceof Date
        ? r.received_at.toISOString()
        : String(r.received_at),
    processed_at:
      r.processed_at instanceof Date
        ? r.processed_at.toISOString()
        : r.processed_at
          ? String(r.processed_at)
          : null,
    retry_count: r.retry_count,
    parent_delivery_id: r.parent_delivery_id,
    source: r.source,
    payload_sample: r.payload_sample,
  }
}
