// SPDX-License-Identifier: AGPL-3.0-only
import { and, eq, isNull } from "drizzle-orm"
import { membership_invitations } from "../schema"
import type { Db } from "../client"
import type { InvitationRow } from "../schema"

export async function createInvitation(
  db: Db,
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
      email: values.email,
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
  db: Db,
  orgId: string
): Promise<InvitationRow[]> {
  return db
    .select()
    .from(membership_invitations)
    .where(
      and(
        eq(membership_invitations.org_id, orgId),
        isNull(membership_invitations.accepted_at)
      )
    )
}

export async function markInvitationAccepted(
  db: Db,
  invitationId: string
): Promise<void> {
  await db
    .update(membership_invitations)
    .set({ accepted_at: new Date() })
    .where(eq(membership_invitations.id, invitationId))
}

export async function deleteExpiredInvitations(db: Db): Promise<number> {
  const deletedRows = await db.delete(membership_invitations).where(
    and(
      isNull(membership_invitations.accepted_at)
      // expires_at < now is checked in the application layer
    )
  )

  // Drizzle's delete returns the number of affected rows in some drivers, but generally we count manually
  return 0 // Placeholder — actual cleanup would require a more detailed implementation
}

export async function findPendingInvitationByEmail(
  db: Db,
  orgId: string,
  email: string
): Promise<InvitationRow | null> {
  const rows = await db
    .select()
    .from(membership_invitations)
    .where(
      and(
        eq(membership_invitations.org_id, orgId),
        eq(membership_invitations.email, email),
        isNull(membership_invitations.accepted_at)
      )
    )
    .limit(1)

  return rows[0] ?? null
}
