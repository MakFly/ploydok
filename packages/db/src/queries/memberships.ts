// SPDX-License-Identifier: AGPL-3.0-only
import { and, eq, inArray, isNotNull } from "drizzle-orm"
import { memberships, users } from "../schema"
import type { Db } from "../client"
import type { MembershipRow } from "../schema"

export async function listMembershipsForOrg(
  db: Db,
  orgId: string
): Promise<
  Array<{
    user_id: string
    role: string
    invited_at: Date
    accepted_at: Date | null
    user: {
      email: string
      display_name: string
    }
  }>
> {
  const rows = await db
    .select({
      user_id: memberships.user_id,
      role: memberships.role,
      invited_at: memberships.invited_at,
      accepted_at: memberships.accepted_at,
      user: {
        email: users.email,
        display_name: users.display_name,
      },
    })
    .from(memberships)
    .innerJoin(users, eq(memberships.user_id, users.id))
    .where(eq(memberships.org_id, orgId))

  return rows
}

export async function getMembership(
  db: Db,
  orgId: string,
  userId: string
): Promise<MembershipRow | null> {
  const rows = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.org_id, orgId), eq(memberships.user_id, userId)))
    .limit(1)

  return rows[0] ?? null
}

export async function hasRole(
  db: Db,
  orgId: string,
  userId: string,
  roles: Array<"owner" | "member">
): Promise<boolean> {
  const rows = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.org_id, orgId),
        eq(memberships.user_id, userId),
        inArray(memberships.role, roles),
        isNotNull(memberships.accepted_at)
      )
    )
    .limit(1)

  return rows.length > 0
}

export async function insertMembership(
  db: Db,
  values: {
    id: string
    org_id: string
    user_id: string
    role: string
    invited_by?: string
    invited_at?: Date
    accepted_at?: Date
  }
): Promise<MembershipRow> {
  const rows = await db
    .insert(memberships)
    .values({
      id: values.id,
      org_id: values.org_id,
      user_id: values.user_id,
      role: values.role,
      invited_by: values.invited_by,
      invited_at: values.invited_at,
      accepted_at: values.accepted_at,
    })
    .returning()

  return rows[0]!
}

export async function removeMembership(
  db: Db,
  orgId: string,
  userId: string
): Promise<void> {
  await db
    .delete(memberships)
    .where(and(eq(memberships.org_id, orgId), eq(memberships.user_id, userId)))
}

export async function updateMembershipRole(
  db: Db,
  orgId: string,
  userId: string,
  role: string
): Promise<void> {
  await db
    .update(memberships)
    .set({ role })
    .where(and(eq(memberships.org_id, orgId), eq(memberships.user_id, userId)))
}

export async function isOrgOwner(
  db: Db,
  orgId: string,
  userId: string
): Promise<boolean> {
  return hasRole(db, orgId, userId, ["owner"])
}

export async function countOwners(db: Db, orgId: string): Promise<number> {
  const rows = await db
    .select({ count: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.org_id, orgId),
        eq(memberships.role, "owner"),
        isNotNull(memberships.accepted_at)
      )
    )

  return rows.length
}

export async function listOrgIdsForUser(
  db: Db,
  userId: string
): Promise<string[]> {
  const rows = await db
    .select({ org_id: memberships.org_id })
    .from(memberships)
    .where(
      and(eq(memberships.user_id, userId), isNotNull(memberships.accepted_at))
    )

  return rows.map((r) => r.org_id)
}
