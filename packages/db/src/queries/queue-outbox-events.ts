// SPDX-License-Identifier: AGPL-3.0-only
import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm"
import { nanoid } from "nanoid"
import type { Db } from "../client"
import { queue_outbox_events } from "../schema"
import type { QueueOutboxEventRow } from "../schema"

const DEFAULT_LEASE_MS = 30_000

export async function insertQueueOutboxEvent(
  db: Pick<Db, "insert">,
  values: {
    id: string
    queue_name: string
    job_name: string
    job_id: string
    source_row_id: string
    actor_user_id?: string | null
    source?: string
    payload: Record<string, unknown>
    job_options?: Record<string, unknown>
  }
): Promise<QueueOutboxEventRow> {
  const rows = await db
    .insert(queue_outbox_events)
    .values({ ...values, job_options: values.job_options ?? {} })
    .returning()
  if (!rows[0]) throw new Error("Failed to persist queue outbox event")
  return rows[0]
}

export async function claimQueueOutboxEvent(
  db: Db,
  options: {
    id?: string
    now?: Date
    leaseMs?: number
    leaseToken?: string
  } = {}
): Promise<{ event: QueueOutboxEventRow; leaseToken: string } | null> {
  const now = options.now ?? new Date()
  const leaseToken = options.leaseToken ?? nanoid()
  const leaseUntil = new Date(
    now.getTime() + (options.leaseMs ?? DEFAULT_LEASE_MS)
  )
  const availability = and(
    isNull(queue_outbox_events.dispatched_at),
    lte(queue_outbox_events.available_at, now),
    or(
      isNull(queue_outbox_events.lease_until),
      lte(queue_outbox_events.lease_until, now)
    ),
    ...(options.id ? [eq(queue_outbox_events.id, options.id)] : [])
  )

  const candidates = await db
    .select({ id: queue_outbox_events.id })
    .from(queue_outbox_events)
    .where(availability)
    .orderBy(
      asc(queue_outbox_events.available_at),
      asc(queue_outbox_events.created_at)
    )
    .limit(options.id ? 1 : 20)

  for (const candidate of candidates) {
    const rows = await db
      .update(queue_outbox_events)
      .set({
        lease_token: leaseToken,
        lease_until: leaseUntil,
        attempt_count: sql`${queue_outbox_events.attempt_count} + 1`,
        updated_at: now,
      })
      .where(
        and(
          eq(queue_outbox_events.id, candidate.id),
          isNull(queue_outbox_events.dispatched_at),
          lte(queue_outbox_events.available_at, now),
          or(
            isNull(queue_outbox_events.lease_until),
            lte(queue_outbox_events.lease_until, now)
          )
        )
      )
      .returning()
    if (rows[0]) return { event: rows[0], leaseToken }
  }
  return null
}

export async function completeQueueOutboxEvent(
  db: Pick<Db, "update">,
  id: string,
  leaseToken: string,
  now = new Date()
): Promise<boolean> {
  const rows = await db
    .update(queue_outbox_events)
    .set({
      dispatched_at: now,
      lease_token: null,
      lease_until: null,
      last_error: null,
      updated_at: now,
    })
    .where(
      and(
        eq(queue_outbox_events.id, id),
        eq(queue_outbox_events.lease_token, leaseToken),
        isNull(queue_outbox_events.dispatched_at)
      )
    )
    .returning({ id: queue_outbox_events.id })
  return rows.length === 1
}

export async function retryQueueOutboxEvent(
  db: Pick<Db, "update">,
  id: string,
  leaseToken: string,
  error: string,
  availableAt: Date,
  now = new Date()
): Promise<boolean> {
  const rows = await db
    .update(queue_outbox_events)
    .set({
      available_at: availableAt,
      lease_token: null,
      lease_until: null,
      last_error: error.slice(0, 2_000),
      updated_at: now,
    })
    .where(
      and(
        eq(queue_outbox_events.id, id),
        eq(queue_outbox_events.lease_token, leaseToken),
        isNull(queue_outbox_events.dispatched_at)
      )
    )
    .returning({ id: queue_outbox_events.id })
  return rows.length === 1
}
