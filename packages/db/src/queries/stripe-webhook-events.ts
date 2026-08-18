// SPDX-License-Identifier: AGPL-3.0-only
import { and, eq, isNull, lte, sql } from "drizzle-orm"
import { nanoid } from "nanoid"
import type { Db } from "../client"
import { stripe_webhook_events } from "../schema"

const DEFAULT_LEASE_MS = 5 * 60 * 1000

export type StripeWebhookClaim =
  | { status: "claimed"; leaseToken: string }
  | { status: "processed" }
  | { status: "busy" }

export interface StripeWebhookClaimOptions {
  now?: Date
  leaseMs?: number
  leaseToken?: string
}

/**
 * Atomically claims a new event or an expired unfinished event.
 *
 * The conditional conflict update is the concurrency boundary: a completed
 * event and a currently leased event both produce an empty RETURNING result.
 */
export async function claimStripeWebhookEvent(
  db: Db,
  event: { id: string; type: string },
  options: StripeWebhookClaimOptions = {}
): Promise<StripeWebhookClaim> {
  const now = options.now ?? new Date()
  const leaseUntil = new Date(
    now.getTime() + (options.leaseMs ?? DEFAULT_LEASE_MS)
  )
  const leaseToken = options.leaseToken ?? nanoid()

  const claimed = await db
    .insert(stripe_webhook_events)
    .values({
      event_id: event.id,
      event_type: event.type,
      lease_token: leaseToken,
      lease_until: leaseUntil,
      attempt_count: 1,
      last_error: null,
      created_at: now,
      updated_at: now,
    })
    .onConflictDoUpdate({
      target: stripe_webhook_events.event_id,
      set: {
        event_type: event.type,
        lease_token: leaseToken,
        lease_until: leaseUntil,
        attempt_count: sql`${stripe_webhook_events.attempt_count} + 1`,
        last_error: null,
        updated_at: now,
      },
      setWhere: and(
        isNull(stripe_webhook_events.processed_at),
        lte(stripe_webhook_events.lease_until, now)
      )!,
    })
    .returning({ leaseToken: stripe_webhook_events.lease_token })

  if (claimed[0]?.leaseToken === leaseToken) {
    return { status: "claimed", leaseToken }
  }

  const existing = await db
    .select({ processedAt: stripe_webhook_events.processed_at })
    .from(stripe_webhook_events)
    .where(eq(stripe_webhook_events.event_id, event.id))
    .limit(1)

  return existing[0]?.processedAt ? { status: "processed" } : { status: "busy" }
}

/** Marks an event complete only for the worker that still owns its lease. */
export async function completeStripeWebhookEvent(
  db: Db,
  eventId: string,
  leaseToken: string,
  now = new Date()
): Promise<boolean> {
  const rows = await db
    .update(stripe_webhook_events)
    .set({
      processed_at: now,
      lease_token: null,
      lease_until: now,
      last_error: null,
      updated_at: now,
    })
    .where(
      and(
        eq(stripe_webhook_events.event_id, eventId),
        eq(stripe_webhook_events.lease_token, leaseToken),
        isNull(stripe_webhook_events.processed_at)
      )
    )
    .returning({ eventId: stripe_webhook_events.event_id })

  return rows.length === 1
}

/** Releases a failed claim immediately so Stripe's next retry need not wait. */
export async function releaseStripeWebhookEvent(
  db: Db,
  eventId: string,
  leaseToken: string,
  error: string,
  now = new Date()
): Promise<boolean> {
  const rows = await db
    .update(stripe_webhook_events)
    .set({
      lease_token: null,
      lease_until: now,
      last_error: error.slice(0, 2_000),
      updated_at: now,
    })
    .where(
      and(
        eq(stripe_webhook_events.event_id, eventId),
        eq(stripe_webhook_events.lease_token, leaseToken),
        isNull(stripe_webhook_events.processed_at)
      )
    )
    .returning({ eventId: stripe_webhook_events.event_id })

  return rows.length === 1
}
