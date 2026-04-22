// SPDX-License-Identifier: AGPL-3.0-only
import { and, desc, eq, lt } from "drizzle-orm"
import { apps, projects, webhook_deliveries } from "@ploydok/db"
import type { Db } from "@ploydok/db"

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

/**
 * Returns deliveries for an app with cursor-based pagination on received_at DESC.
 * Ownership is verified via project join — returns null if not owned by userId.
 */
export async function listDeliveriesByApp(
  db: Db,
  appId: string,
  userId: string,
  limit: number,
  cursor?: string,
): Promise<ListDeliveriesResult | null> {
  // Verify ownership
  const appRows = await db
    .select({ id: apps.id })
    .from(apps)
    .innerJoin(projects, eq(apps.project_id, projects.id))
    .where(and(eq(apps.id, appId), eq(projects.owner_id, userId)))
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
            lt(webhook_deliveries.received_at, cursorDate),
          )
        : eq(webhook_deliveries.app_id, appId),
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
      received_at: r.received_at instanceof Date ? r.received_at.toISOString() : String(r.received_at),
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
    next_cursor: hasMore && page[page.length - 1]
      ? (page[page.length - 1]!.received_at instanceof Date
          ? (page[page.length - 1]!.received_at as Date).toISOString()
          : String(page[page.length - 1]!.received_at))
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
 * Ownership is verified — returns null if not owned by userId or not found.
 */
export async function getDeliveryById(
  db: Db,
  appId: string,
  deliveryId: string,
  userId: string,
): Promise<DeliveryDetail | null> {
  // Verify app ownership
  const appRows = await db
    .select({ id: apps.id })
    .from(apps)
    .innerJoin(projects, eq(apps.project_id, projects.id))
    .where(and(eq(apps.id, appId), eq(projects.owner_id, userId)))
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
        eq(webhook_deliveries.app_id, appId),
      ),
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
    received_at: r.received_at instanceof Date ? r.received_at.toISOString() : String(r.received_at),
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
