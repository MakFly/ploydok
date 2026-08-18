// SPDX-License-Identifier: AGPL-3.0-only
import { and, eq, gt, isNull, lte, sql } from "drizzle-orm"
import { membership_invitations, outbox_events } from "../schema"
import type { Db } from "../client"
import type { InvitationRow } from "../schema"

export async function createInvitation(
  db: Pick<Db, "insert">,
  values: {
    id: string
    org_id: string
    email: string
    role: string
    token_hash: string
    invited_by: string
    expires_at: Date
  }
): Promise<InvitationRow> {
  const rows = await db
    .insert(membership_invitations)
    .values({
      id: values.id,
      org_id: values.org_id,
      email: values.email.trim().toLowerCase(),
      role: values.role,
      token_hash: values.token_hash,
      invited_by: values.invited_by,
      expires_at: values.expires_at,
    })
    .returning()

  return rows[0]!
}

export async function getInvitationByTokenHash(
  db: Db,
  tokenHash: string
): Promise<InvitationRow | null> {
  const rows = await db
    .select()
    .from(membership_invitations)
    .where(
      and(
        eq(membership_invitations.token_hash, tokenHash),
        isNull(membership_invitations.accepted_at)
        // expires_at > now is checked in the application layer
      )
    )
    .limit(1)

  return rows[0] ?? null
}

export async function listPendingInvitationsForOrg(
  db: Pick<Db, "select">,
  orgId: string,
  now = new Date()
): Promise<InvitationRow[]> {
  return db
    .select()
    .from(membership_invitations)
    .where(
      and(
        eq(membership_invitations.org_id, orgId),
        isNull(membership_invitations.accepted_at),
        gt(membership_invitations.expires_at, now)
      )
    )
}

export async function markInvitationAccepted(
  db: Pick<Db, "update">,
  invitationId: string
): Promise<void> {
  await db
    .update(membership_invitations)
    .set({ accepted_at: new Date() })
    .where(eq(membership_invitations.id, invitationId))
}

/** Atomically consumes one still-pending, non-expired invitation. */
export async function claimInvitationByTokenHash(
  db: Pick<Db, "update" | "select" | "execute">,
  tokenHash: string,
  acceptedAt: Date
): Promise<
  | { status: "claimed"; invitation: InvitationRow }
  | { status: "busy" }
  | { status: "unavailable" }
> {
  // Serialize with the outbox claim before evaluating its active lease.
  await db.execute(sql`
    SELECT ${membership_invitations.id}
    FROM ${membership_invitations}
    WHERE ${membership_invitations.token_hash} = ${tokenHash}
    FOR UPDATE
  `)
  const rows = await db
    .update(membership_invitations)
    .set({ accepted_at: acceptedAt })
    .where(
      and(
        eq(membership_invitations.token_hash, tokenHash),
        isNull(membership_invitations.accepted_at),
        gt(membership_invitations.expires_at, acceptedAt),
        noActiveInvitationDelivery(acceptedAt)
      )
    )
    .returning()

  if (rows[0]) return { status: "claimed", invitation: rows[0] }

  const pending = await db
    .select({ id: membership_invitations.id })
    .from(membership_invitations)
    .where(
      and(
        eq(membership_invitations.token_hash, tokenHash),
        isNull(membership_invitations.accepted_at),
        gt(membership_invitations.expires_at, acceptedAt)
      )
    )
    .limit(1)
  if (!pending[0]) return { status: "unavailable" }
  const activeDelivery = await db
    .select({ id: outbox_events.id })
    .from(outbox_events)
    .where(
      and(
        eq(outbox_events.invitation_id, pending[0].id),
        isNull(outbox_events.delivered_at),
        isNull(outbox_events.dead_lettered_at),
        gt(outbox_events.lease_until, acceptedAt)
      )
    )
    .limit(1)
  return activeDelivery[0] ? { status: "busy" } : { status: "unavailable" }
}

export async function deleteExpiredInvitations(
  db: Pick<Db, "delete" | "execute">,
  options: { now?: Date; orgId?: string; email?: string } = {}
): Promise<number> {
  const now = options.now ?? new Date()
  if (options.orgId && options.email) {
    const reinvitationKey = `${options.orgId}:${options.email.trim().toLowerCase()}`
    await db.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${reinvitationKey}, 0))`
    )
  }
  const lockConditions = [
    isNull(membership_invitations.accepted_at),
    lte(membership_invitations.expires_at, now),
  ]
  if (options.orgId) {
    lockConditions.push(eq(membership_invitations.org_id, options.orgId))
  }
  if (options.email) {
    lockConditions.push(
      sql<boolean>`lower(${membership_invitations.email}) = ${options.email.trim().toLowerCase()}`
    )
  }
  const conditions = [...lockConditions, noActiveInvitationDelivery(now)]

  // Lock candidate invitation rows before checking/deleting their outbox
  // children. The dispatcher takes this exact lock before publishing a lease.
  await db.execute(sql`
    SELECT ${membership_invitations.id}
    FROM ${membership_invitations}
    WHERE ${and(...lockConditions)}
    FOR UPDATE
  `)

  const deletedRows = await db
    .delete(membership_invitations)
    .where(and(...conditions))
    .returning({ id: membership_invitations.id })

  return deletedRows.length
}

function noActiveInvitationDelivery(now: Date) {
  return sql<boolean>`NOT EXISTS (
    SELECT 1 FROM ${outbox_events}
    WHERE ${outbox_events.invitation_id} = ${membership_invitations.id}
      AND ${outbox_events.delivered_at} IS NULL
      AND ${outbox_events.dead_lettered_at} IS NULL
      AND ${outbox_events.lease_until} > ${now.toISOString()}::timestamptz
  )`
}

/** Deletes only when no dispatcher can still perform an SMTP side effect. */
export async function deleteInvitationUnlessDeliveryActive(
  db: Pick<Db, "delete" | "select" | "execute">,
  invitationId: string,
  orgId: string,
  now = new Date()
): Promise<"deleted" | "busy" | "not-found"> {
  await db.execute(sql`
    SELECT ${membership_invitations.id}
    FROM ${membership_invitations}
    WHERE ${membership_invitations.id} = ${invitationId}
      AND ${membership_invitations.org_id} = ${orgId}
    FOR UPDATE
  `)
  const rows = await db
    .delete(membership_invitations)
    .where(
      and(
        eq(membership_invitations.id, invitationId),
        eq(membership_invitations.org_id, orgId),
        noActiveInvitationDelivery(now)
      )
    )
    .returning({ id: membership_invitations.id })
  if (rows.length === 1) return "deleted"

  const existing = await db
    .select({ id: membership_invitations.id })
    .from(membership_invitations)
    .where(
      and(
        eq(membership_invitations.id, invitationId),
        eq(membership_invitations.org_id, orgId)
      )
    )
    .limit(1)
  return existing.length === 1 ? "busy" : "not-found"
}

export async function findPendingInvitationByEmail(
  db: Pick<Db, "select">,
  orgId: string,
  email: string,
  now = new Date()
): Promise<InvitationRow | null> {
  const rows = await db
    .select()
    .from(membership_invitations)
    .where(
      and(
        eq(membership_invitations.org_id, orgId),
        eq(membership_invitations.email, email.trim().toLowerCase()),
        isNull(membership_invitations.accepted_at),
        gt(membership_invitations.expires_at, now)
      )
    )
    .limit(1)

  return rows[0] ?? null
}

export async function getPendingInvitationById(
  db: Pick<Db, "select">,
  id: string,
  now = new Date()
): Promise<InvitationRow | null> {
  const rows = await db
    .select()
    .from(membership_invitations)
    .where(
      and(
        eq(membership_invitations.id, id),
        isNull(membership_invitations.accepted_at),
        gt(membership_invitations.expires_at, now)
      )
    )
    .limit(1)
  return rows[0] ?? null
}
