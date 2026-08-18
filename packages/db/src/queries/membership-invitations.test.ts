// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { eq, sql } from "drizzle-orm"
import { nanoid } from "nanoid"
import postgres from "postgres"
import { createDb } from "../client"
import {
  membership_invitations,
  memberships,
  outbox_events,
  projects,
  sessions,
  users,
} from "../schema"
import {
  claimInvitationByTokenHash,
  createInvitation,
  deleteInvitationUnlessDeliveryActive,
  deleteExpiredInvitations,
} from "./membership-invitations"
import { insertMembershipIfAbsent } from "./memberships"
import {
  claimNextOutboxEvent,
  heartbeatOutboxEvent,
  insertOutboxEvent,
  retryOutboxEvent,
} from "./outbox-events"

const PG_URL = Bun.env["PLOYDOK_TEST_PG_URL"]
const skip = !PG_URL
const prefix = `invite-claim-${nanoid(8)}`

if (skip)
  console.log(
    "[membership-invitations.test] PLOYDOK_TEST_PG_URL not set — skipping"
  )

describe.skipIf(skip)("invitation claim fencing", () => {
  const db = createDb(PG_URL!)
  let migrationSql: ReturnType<typeof postgres>
  const ownerId = `${prefix}-owner`
  const orgId = `${prefix}-org`

  beforeAll(async () => {
    migrationSql = postgres(PG_URL!, { max: 1 })
    await migrate(drizzle(migrationSql), {
      migrationsFolder: `${import.meta.dir}/../../migrations`,
    })
    const now = new Date()
    await db.insert(users).values({
      id: ownerId,
      email: `${prefix}@example.com`,
      display_name: "Owner",
      created_at: now,
      updated_at: now,
    })
    await db.insert(projects).values({
      id: orgId,
      owner_id: ownerId,
      name: "Claim test",
      slug: orgId,
      created_at: now,
    })
  })

  afterAll(async () => {
    await db
      .delete(users)
      .where(eq(users.id, ownerId))
      .catch(() => {})
    await migrationSql.end()
  })

  it("allows exactly one concurrent claim", async () => {
    const tokenHash = `${prefix}-token`
    await db.insert(membership_invitations).values({
      id: `${prefix}-invitation`,
      org_id: orgId,
      email: "member@example.com",
      role: "member",
      token_hash: tokenHash,
      invited_by: ownerId,
      expires_at: new Date(Date.now() + 60_000),
    })
    const [a, b] = await Promise.all([
      claimInvitationByTokenHash(db, tokenHash, new Date()),
      claimInvitationByTokenHash(db, tokenHash, new Date()),
    ])
    expect([a, b].filter((result) => result.status === "claimed")).toHaveLength(
      1
    )
  })

  it("does not claim an expired invitation", async () => {
    const tokenHash = `${prefix}-expired`
    await db.insert(membership_invitations).values({
      id: `${prefix}-expired-invitation`,
      org_id: orgId,
      email: "expired@example.com",
      role: "member",
      token_hash: tokenHash,
      invited_by: ownerId,
      expires_at: new Date(Date.now() - 1_000),
    })
    expect(await claimInvitationByTokenHash(db, tokenHash, new Date())).toEqual(
      { status: "unavailable" }
    )
  })

  it("fences accept and revoke for the exact duration of an SMTP lease", async () => {
    const invitationId = `${prefix}-smtp-fence-invitation`
    const eventId = `${prefix}-smtp-fence-event`
    const tokenHash = `${prefix}-smtp-fence-token`
    const now = new Date()
    await createInvitation(db, {
      id: invitationId,
      org_id: orgId,
      email: `${prefix}-smtp-fence@example.com`,
      role: "member",
      token_hash: tokenHash,
      invited_by: ownerId,
      expires_at: new Date(now.getTime() + 60_000),
    })
    await insertOutboxEvent(db, {
      id: eventId,
      invitation_id: invitationId,
      topic: "mail.invitation",
      payload_ciphertext: Buffer.from("ciphertext"),
      payload_nonce: Buffer.from("nonce"),
      available_at: now,
    })
    const leaseToken = `${prefix}-smtp-owner`
    expect(
      (
        await claimNextOutboxEvent(db, { now, leaseToken, leaseMs: 45_000 })
      )?.event.id
    ).toBe(eventId)

    expect(
      await claimInvitationByTokenHash(
        db,
        tokenHash,
        new Date(now.getTime() + 1)
      )
    ).toEqual({ status: "busy" })
    expect(
      await deleteInvitationUnlessDeliveryActive(
        db,
        invitationId,
        orgId,
        new Date(now.getTime() + 1)
      )
    ).toBe("busy")

    expect(
      await retryOutboxEvent(db, eventId, leaseToken, "released", now, now)
    ).toBe(true)
    expect(
      (
        await claimInvitationByTokenHash(
          db,
          tokenHash,
          new Date(now.getTime() + 2)
        )
      ).status
    ).toBe("claimed")
  })

  it("cascades an unleased event before revocation returns success", async () => {
    const invitationId = `${prefix}-revoke-fence-invitation`
    const eventId = `${prefix}-revoke-fence-event`
    await createInvitation(db, {
      id: invitationId,
      org_id: orgId,
      email: `${prefix}-revoke-fence@example.com`,
      role: "member",
      token_hash: `${prefix}-revoke-fence-token`,
      invited_by: ownerId,
      expires_at: new Date(Date.now() + 60_000),
    })
    await insertOutboxEvent(db, {
      id: eventId,
      invitation_id: invitationId,
      topic: "mail.invitation",
      payload_ciphertext: Buffer.from("ciphertext"),
      payload_nonce: Buffer.from("nonce"),
    })

    expect(
      await deleteInvitationUnlessDeliveryActive(db, invitationId, orgId)
    ).toBe("deleted")
    expect(
      await db
        .select({ id: outbox_events.id })
        .from(outbox_events)
        .where(eq(outbox_events.id, eventId))
    ).toHaveLength(0)
  })

  it("serializes revocation and outbox claim on the invitation row", async () => {
    await db
      .delete(outbox_events)
      .where(sql`${outbox_events.id} like ${`${prefix}%`}`)
    const invitationId = `${prefix}-interleaved-revoke-invitation`
    const eventId = `${prefix}-interleaved-revoke-event`
    await createInvitation(db, {
      id: invitationId,
      org_id: orgId,
      email: `${prefix}-interleaved-revoke@example.com`,
      role: "member",
      token_hash: `${prefix}-interleaved-revoke-token`,
      invited_by: ownerId,
      expires_at: new Date(Date.now() + 60_000),
    })
    await insertOutboxEvent(db, {
      id: eventId,
      invitation_id: invitationId,
      topic: "mail.invitation",
      payload_ciphertext: Buffer.from("ciphertext"),
      payload_nonce: Buffer.from("nonce"),
    })

    let releaseRevocation!: () => void
    const holdRevocation = new Promise<void>((resolve) => {
      releaseRevocation = resolve
    })
    let rowLocked!: () => void
    const locked = new Promise<void>((resolve) => {
      rowLocked = resolve
    })
    const revocation = db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT ${membership_invitations.id}
        FROM ${membership_invitations}
        WHERE ${membership_invitations.id} = ${invitationId}
        FOR UPDATE
      `)
      rowLocked()
      await holdRevocation
      return deleteInvitationUnlessDeliveryActive(tx, invitationId, orgId)
    })

    await locked
    let claimSettled = false
    const concurrentClaim = claimNextOutboxEvent(db, {
      leaseToken: `${prefix}-interleaved-worker`,
    }).finally(() => {
      claimSettled = true
    })
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(claimSettled).toBe(false)

    releaseRevocation()
    expect(await revocation).toBe("deleted")
    expect(await concurrentClaim).toBeNull()
  })

  it("serializes revocation and an active SMTP heartbeat", async () => {
    const invitationId = `${prefix}-heartbeat-revoke-invitation`
    const eventId = `${prefix}-heartbeat-revoke-event`
    const leaseToken = `${prefix}-heartbeat-worker`
    const now = new Date()
    await createInvitation(db, {
      id: invitationId,
      org_id: orgId,
      email: `${prefix}-heartbeat-revoke@example.com`,
      role: "member",
      token_hash: `${prefix}-heartbeat-revoke-token`,
      invited_by: ownerId,
      expires_at: new Date(now.getTime() + 60_000),
    })
    await insertOutboxEvent(db, {
      id: eventId,
      invitation_id: invitationId,
      topic: "mail.invitation",
      payload_ciphertext: Buffer.from("ciphertext"),
      payload_nonce: Buffer.from("nonce"),
      available_at: now,
    })
    expect(
      await claimNextOutboxEvent(db, { now, leaseToken, leaseMs: 45_000 })
    ).not.toBeNull()

    let releaseRevocation!: () => void
    const holdRevocation = new Promise<void>((resolve) => {
      releaseRevocation = resolve
    })
    let rowLocked!: () => void
    const locked = new Promise<void>((resolve) => {
      rowLocked = resolve
    })
    const revocation = db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT ${membership_invitations.id}
        FROM ${membership_invitations}
        WHERE ${membership_invitations.id} = ${invitationId}
        FOR UPDATE
      `)
      rowLocked()
      await holdRevocation
      return deleteInvitationUnlessDeliveryActive(
        tx,
        invitationId,
        orgId,
        new Date(now.getTime() + 45_001)
      )
    })

    await locked
    let heartbeatSettled = false
    const heartbeat = heartbeatOutboxEvent(
      db,
      eventId,
      leaseToken,
      new Date(now.getTime() + 1),
      45_000
    ).finally(() => {
      heartbeatSettled = true
    })
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(heartbeatSettled).toBe(false)

    releaseRevocation()
    expect(await revocation).toBe("deleted")
    expect(await heartbeat).toBe(false)
  })

  it("cleans an expired slot and permits exactly one concurrent reinvitation", async () => {
    const email = `${prefix}-reinvite@example.com`
    await db.insert(membership_invitations).values({
      id: `${prefix}-reinvite-expired`,
      org_id: orgId,
      email,
      role: "member",
      token_hash: `${prefix}-reinvite-expired-token`,
      invited_by: ownerId,
      expires_at: new Date(Date.now() - 1_000),
    })

    const invite = (suffix: string) =>
      db.transaction(async (tx) => {
        await deleteExpiredInvitations(tx, { orgId, email, now: new Date() })
        return createInvitation(tx, {
          id: `${prefix}-reinvite-${suffix}`,
          org_id: orgId,
          email,
          role: "member",
          token_hash: `${prefix}-reinvite-token-${suffix}`,
          invited_by: ownerId,
          expires_at: new Date(Date.now() + 60_000),
        })
      })

    const results = await Promise.allSettled([invite("a"), invite("b")])
    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1)
    expect(
      results.filter((result) => result.status === "rejected")
    ).toHaveLength(1)
  })

  it("rolls claim, account, session and membership back together", async () => {
    const email = `${prefix}-rollback@example.com`
    const userId = `${prefix}-rollback-user`
    const tokenHash = `${prefix}-rollback-token`
    await db.insert(membership_invitations).values({
      id: `${prefix}-rollback-invitation`,
      org_id: orgId,
      email,
      role: "member",
      token_hash: tokenHash,
      invited_by: ownerId,
      expires_at: new Date(Date.now() + 60_000),
    })

    await expect(
      db.transaction(async (tx) => {
        const acceptedAt = new Date()
        const claimed = await claimInvitationByTokenHash(
          tx,
          tokenHash,
          acceptedAt
        )
        expect(claimed.status).toBe("claimed")
        await tx.insert(users).values({
          id: userId,
          email,
          display_name: "Rollback member",
          password_hash: "not-a-real-hash",
          created_at: acceptedAt,
          updated_at: acceptedAt,
        })
        await insertMembershipIfAbsent(tx, {
          id: `${prefix}-rollback-membership`,
          org_id: orgId,
          user_id: userId,
          role: "member",
          invited_by: ownerId,
          invited_at: acceptedAt,
          accepted_at: acceptedAt,
        })
        await tx.insert(sessions).values({
          id: `${prefix}-rollback-session`,
          user_id: userId,
          refresh_token_hash: "refresh-hash",
          user_agent: "PostgreSQL integration test",
          ip: "127.0.0.1",
          created_at: acceptedAt,
          last_seen_at: acceptedAt,
          expires_at: new Date(acceptedAt.getTime() + 60_000),
        })
        throw new Error("forced rollback")
      })
    ).rejects.toThrow("forced rollback")

    expect(
      await db.select({ id: users.id }).from(users).where(eq(users.id, userId))
    ).toHaveLength(0)
    expect(
      await db
        .select({ id: memberships.id })
        .from(memberships)
        .where(eq(memberships.user_id, userId))
    ).toHaveLength(0)
    expect(
      await db
        .select({ id: sessions.id })
        .from(sessions)
        .where(eq(sessions.user_id, userId))
    ).toHaveLength(0)
    expect(
      (await claimInvitationByTokenHash(db, tokenHash, new Date())).status
    ).toBe("claimed")
  })
})
