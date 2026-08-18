// SPDX-License-Identifier: AGPL-3.0-only
import { and, asc, eq, gt, isNull, lte, or, sql } from "drizzle-orm"
import { nanoid } from "nanoid"
import type { Db } from "../client"
import { membership_invitations, outbox_events } from "../schema"
import type { OutboxEventRow } from "../schema"

const DEFAULT_LEASE_MS = 60_000

export async function insertOutboxEvent(
  db: Pick<Db, "insert">,
  values: {
    id: string
    invitation_id?: string
    topic: string
    payload_ciphertext: Buffer
    payload_nonce: Buffer
    available_at?: Date
  }
): Promise<OutboxEventRow> {
  const rows = await db
    .insert(outbox_events)
    .values({
      ...values,
      available_at: values.available_at ?? new Date(),
    })
    .onConflictDoNothing({ target: outbox_events.id })
    .returning()
  if (rows[0]) return rows[0]

  throw new Error(`Outbox event already exists: ${values.id}`)
}

export async function getOutboxEvent(
  db: Pick<Db, "select">,
  id: string
): Promise<OutboxEventRow | null> {
  const rows = await db
    .select()
    .from(outbox_events)
    .where(eq(outbox_events.id, id))
    .limit(1)
  return rows[0] ?? null
}

export async function makeOutboxEventAvailable(
  db: Pick<Db, "update">,
  id: string,
  now = new Date()
): Promise<boolean> {
  const rows = await db
    .update(outbox_events)
    .set({ available_at: now, last_error: null, updated_at: now })
    .where(
      and(
        eq(outbox_events.id, id),
        isNull(outbox_events.delivered_at),
        isNull(outbox_events.dead_lettered_at)
      )
    )
    .returning({ id: outbox_events.id })
  return rows.length === 1
}

export async function claimNextOutboxEvent(
  db: Db,
  options: { now?: Date; leaseMs?: number; leaseToken?: string } = {}
): Promise<{ event: OutboxEventRow; leaseToken: string } | null> {
  const now = options.now ?? new Date()
  const leaseToken = options.leaseToken ?? nanoid()
  const leaseUntil = new Date(
    now.getTime() + (options.leaseMs ?? DEFAULT_LEASE_MS)
  )

  const candidates = await db
    .select({ id: outbox_events.id })
    .from(outbox_events)
    .where(
      and(
        isNull(outbox_events.delivered_at),
        isNull(outbox_events.dead_lettered_at),
        lte(outbox_events.available_at, now),
        or(
          isNull(outbox_events.lease_until),
          lte(outbox_events.lease_until, now)
        )
      )
    )
    .orderBy(asc(outbox_events.available_at), asc(outbox_events.created_at))
    .limit(10)

  for (const candidate of candidates) {
    const event = await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ invitationId: outbox_events.invitation_id })
        .from(outbox_events)
        .where(eq(outbox_events.id, candidate.id))
        .limit(1)
      if (!current) return null

      // Accept/revoke/expiry cleanup lock the same invitation row. Holding it
      // while publishing the lease removes the check-then-send race.
      if (current.invitationId) {
        await tx.execute(sql`
          SELECT ${membership_invitations.id}
          FROM ${membership_invitations}
          WHERE ${membership_invitations.id} = ${current.invitationId}
          FOR UPDATE
        `)
      }

      const rows = await tx
        .update(outbox_events)
        .set({
          lease_token: leaseToken,
          lease_until: leaseUntil,
          attempt_count: sql`${outbox_events.attempt_count} + 1`,
          updated_at: now,
        })
        .where(
          and(
            eq(outbox_events.id, candidate.id),
            isNull(outbox_events.delivered_at),
            isNull(outbox_events.dead_lettered_at),
            lte(outbox_events.available_at, now),
            or(
              isNull(outbox_events.lease_until),
              lte(outbox_events.lease_until, now)
            )
          )
        )
        .returning()
      return rows[0] ?? null
    })
    if (event) return { event, leaseToken }
  }
  return null
}

export async function heartbeatOutboxEvent(
  db: Db,
  id: string,
  leaseToken: string,
  now: Date,
  leaseMs: number
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ invitationId: outbox_events.invitation_id })
      .from(outbox_events)
      .where(eq(outbox_events.id, id))
      .limit(1)
    if (!current) return false

    if (current.invitationId) {
      await tx.execute(sql`
        SELECT ${membership_invitations.id}
        FROM ${membership_invitations}
        WHERE ${membership_invitations.id} = ${current.invitationId}
        FOR UPDATE
      `)
    }

    const rows = await tx
      .update(outbox_events)
      .set({ lease_until: new Date(now.getTime() + leaseMs), updated_at: now })
      .where(
        and(
          eq(outbox_events.id, id),
          eq(outbox_events.lease_token, leaseToken),
          isNull(outbox_events.delivered_at),
          isNull(outbox_events.dead_lettered_at),
          gt(outbox_events.lease_until, now)
        )
      )
      .returning({ id: outbox_events.id })
    return rows.length === 1
  })
}

export async function completeOutboxEvent(
  db: Pick<Db, "update">,
  id: string,
  leaseToken: string,
  now = new Date()
): Promise<boolean> {
  const rows = await db
    .update(outbox_events)
    .set({
      delivered_at: now,
      // The encrypted payload may contain bearer URLs. Keep the durable event
      // ID for idempotence, but erase sensitive delivery material on success.
      payload_ciphertext: Buffer.alloc(0),
      payload_nonce: Buffer.alloc(0),
      lease_token: null,
      lease_until: null,
      last_error: null,
      updated_at: now,
    })
    .where(
      and(
        eq(outbox_events.id, id),
        eq(outbox_events.lease_token, leaseToken),
        isNull(outbox_events.delivered_at),
        isNull(outbox_events.dead_lettered_at)
      )
    )
    .returning({ id: outbox_events.id })
  return rows.length === 1
}

export async function retryOutboxEvent(
  db: Pick<Db, "update">,
  id: string,
  leaseToken: string,
  error: string,
  availableAt: Date,
  now = new Date()
): Promise<boolean> {
  const rows = await db
    .update(outbox_events)
    .set({
      available_at: availableAt,
      lease_token: null,
      lease_until: null,
      last_error: error.slice(0, 2_000),
      updated_at: now,
    })
    .where(
      and(
        eq(outbox_events.id, id),
        eq(outbox_events.lease_token, leaseToken),
        isNull(outbox_events.delivered_at),
        isNull(outbox_events.dead_lettered_at)
      )
    )
    .returning({ id: outbox_events.id })
  return rows.length === 1
}

export async function deadLetterOutboxEvent(
  db: Pick<Db, "update">,
  id: string,
  leaseToken: string,
  error: string,
  now = new Date()
): Promise<boolean> {
  const rows = await db
    .update(outbox_events)
    .set({
      dead_lettered_at: now,
      payload_ciphertext: Buffer.alloc(0),
      payload_nonce: Buffer.alloc(0),
      lease_token: null,
      lease_until: null,
      last_error: error.slice(0, 2_000),
      updated_at: now,
    })
    .where(
      and(
        eq(outbox_events.id, id),
        eq(outbox_events.lease_token, leaseToken),
        isNull(outbox_events.delivered_at),
        isNull(outbox_events.dead_lettered_at)
      )
    )
    .returning({ id: outbox_events.id })
  return rows.length === 1
}
