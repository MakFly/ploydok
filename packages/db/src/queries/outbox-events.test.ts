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
  outbox_events,
  projects,
  users,
} from "../schema"
import { createInvitation } from "./membership-invitations"
import {
  claimNextOutboxEvent,
  completeOutboxEvent,
  deadLetterOutboxEvent,
  heartbeatOutboxEvent,
  insertOutboxEvent,
  retryOutboxEvent,
} from "./outbox-events"

const PG_URL = Bun.env["PLOYDOK_TEST_PG_URL"]
const skip = !PG_URL
const prefix = `outbox-${nanoid(8)}`

if (skip)
  console.log("[outbox-events.test] PLOYDOK_TEST_PG_URL not set — skipping")

describe.skipIf(skip)("transactional outbox PostgreSQL fencing", () => {
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
      display_name: "Outbox owner",
      created_at: now,
      updated_at: now,
    })
    await db.insert(projects).values({
      id: orgId,
      owner_id: ownerId,
      name: "Outbox test",
      slug: orgId,
      created_at: now,
    })
  })

  afterAll(async () => {
    await db
      .delete(outbox_events)
      .where(sql`${outbox_events.id} like ${`${prefix}%`}`)
      .catch(() => {})
    await db
      .delete(users)
      .where(eq(users.id, ownerId))
      .catch(() => {})
    await migrationSql.end()
  })

  it("allows exactly one concurrent lease owner", async () => {
    const id = `${prefix}-concurrent`
    await insertOutboxEvent(db, {
      id,
      topic: "mail.invitation",
      payload_ciphertext: Buffer.from("ciphertext"),
      payload_nonce: Buffer.from("nonce"),
    })

    const [a, b] = await Promise.all([
      claimNextOutboxEvent(db, { leaseToken: `${prefix}-worker-a` }),
      claimNextOutboxEvent(db, { leaseToken: `${prefix}-worker-b` }),
    ])
    expect([a, b].filter(Boolean)).toHaveLength(1)
  })

  it("rolls invitation and its outbox event back as one transaction", async () => {
    const invitationId = `${prefix}-atomic-invitation`
    const eventId = `invitation-email:${invitationId}`
    await expect(
      db.transaction(async (tx) => {
        await createInvitation(tx, {
          id: invitationId,
          org_id: orgId,
          email: `${prefix}-member@example.com`,
          role: "member",
          token_hash: `${prefix}-atomic-token`,
          invited_by: ownerId,
          expires_at: new Date(Date.now() + 60_000),
        })
        await insertOutboxEvent(tx, {
          id: eventId,
          invitation_id: invitationId,
          topic: "mail.invitation",
          payload_ciphertext: Buffer.from("ciphertext"),
          payload_nonce: Buffer.from("nonce"),
        })
        throw new Error("forced rollback")
      })
    ).rejects.toThrow("forced rollback")

    expect(
      await db
        .select({ id: membership_invitations.id })
        .from(membership_invitations)
        .where(eq(membership_invitations.id, invitationId))
    ).toHaveLength(0)
    expect(
      await db
        .select({ id: outbox_events.id })
        .from(outbox_events)
        .where(eq(outbox_events.id, eventId))
    ).toHaveLength(0)
  })

  it("fences stale completion and recovers a released retry", async () => {
    const id = `${prefix}-retry`
    const now = new Date()
    await insertOutboxEvent(db, {
      id,
      topic: "mail.invitation",
      payload_ciphertext: Buffer.from("ciphertext"),
      payload_nonce: Buffer.from("nonce"),
      available_at: now,
    })
    const claim = await claimNextOutboxEvent(db, {
      now,
      leaseToken: `${prefix}-owner`,
    })
    expect(claim?.event.id).toBe(id)
    expect(await completeOutboxEvent(db, id, `${prefix}-stale`, now)).toBe(
      false
    )
    expect(
      await retryOutboxEvent(
        db,
        id,
        `${prefix}-owner`,
        "temporary failure",
        now,
        now
      )
    ).toBe(true)

    const retry = await claimNextOutboxEvent(db, {
      now,
      leaseToken: `${prefix}-retry-owner`,
    })
    expect(retry?.event.id).toBe(id)
    expect(
      await completeOutboxEvent(db, id, `${prefix}-retry-owner`, now)
    ).toBe(true)
    expect(
      await db
        .select({
          deliveredAt: outbox_events.delivered_at,
          ciphertext: outbox_events.payload_ciphertext,
          nonce: outbox_events.payload_nonce,
        })
        .from(outbox_events)
        .where(eq(outbox_events.id, id))
    ).toEqual([
      { deliveredAt: now, ciphertext: Buffer.alloc(0), nonce: Buffer.alloc(0) },
    ])
  })

  it("dead-letters with lease fencing and erases its sensitive payload", async () => {
    const id = `${prefix}-dead-letter`
    const now = new Date()
    await insertOutboxEvent(db, {
      id,
      topic: "mail.invitation",
      payload_ciphertext: Buffer.from("secret-ciphertext"),
      payload_nonce: Buffer.from("secret-nonce"),
      available_at: now,
    })
    await claimNextOutboxEvent(db, {
      now,
      leaseToken: `${prefix}-dead-owner`,
    })
    expect(
      await deadLetterOutboxEvent(db, id, `${prefix}-stale`, "stale", now)
    ).toBe(false)
    expect(
      await deadLetterOutboxEvent(
        db,
        id,
        `${prefix}-dead-owner`,
        "permanent",
        now
      )
    ).toBe(true)
    const rows = await db
      .select({
        deadLetteredAt: outbox_events.dead_lettered_at,
        ciphertext: outbox_events.payload_ciphertext,
        nonce: outbox_events.payload_nonce,
      })
      .from(outbox_events)
      .where(eq(outbox_events.id, id))
    expect(rows).toEqual([
      {
        deadLetteredAt: now,
        ciphertext: Buffer.alloc(0),
        nonce: Buffer.alloc(0),
      },
    ])
  })

  it("lets a successor reclaim an expired lease and fences the stale sender", async () => {
    const id = `${prefix}-lease-expiry`
    const firstNow = new Date("2026-08-18T10:00:00.000Z")
    await insertOutboxEvent(db, {
      id,
      topic: "mail.invitation",
      payload_ciphertext: Buffer.from("ciphertext"),
      payload_nonce: Buffer.from("nonce"),
      available_at: firstNow,
    })
    expect(
      await claimNextOutboxEvent(db, {
        now: firstNow,
        leaseMs: 1_000,
        leaseToken: `${prefix}-stale`,
      })
    ).not.toBeNull()
    const successorNow = new Date(firstNow.getTime() + 1_001)
    expect(
      await claimNextOutboxEvent(db, {
        now: successorNow,
        leaseToken: `${prefix}-successor`,
      })
    ).not.toBeNull()
    expect(
      await heartbeatOutboxEvent(
        db,
        id,
        `${prefix}-stale`,
        successorNow,
        45_000
      )
    ).toBe(false)
    expect(
      await heartbeatOutboxEvent(
        db,
        id,
        `${prefix}-successor`,
        successorNow,
        45_000
      )
    ).toBe(true)
  })

  it("cascades a revoked invitation event before reinvitation", async () => {
    const invitationId = `${prefix}-revoked-invitation`
    const eventId = `invitation-email:${invitationId}`
    const email = `${prefix}-revoke@example.com`
    await createInvitation(db, {
      id: invitationId,
      org_id: orgId,
      email,
      role: "member",
      token_hash: `${prefix}-revoked-token`,
      invited_by: ownerId,
      expires_at: new Date(Date.now() + 60_000),
    })
    await insertOutboxEvent(db, {
      id: eventId,
      invitation_id: invitationId,
      topic: "mail.invitation",
      payload_ciphertext: Buffer.from("old-ciphertext"),
      payload_nonce: Buffer.from("old-nonce"),
    })
    await db
      .delete(membership_invitations)
      .where(eq(membership_invitations.id, invitationId))
    expect(
      await db
        .select({ id: outbox_events.id })
        .from(outbox_events)
        .where(eq(outbox_events.id, eventId))
    ).toHaveLength(0)

    expect(
      await createInvitation(db, {
        id: `${prefix}-replacement-invitation`,
        org_id: orgId,
        email,
        role: "member",
        token_hash: `${prefix}-replacement-token`,
        invited_by: ownerId,
        expires_at: new Date(Date.now() + 60_000),
      })
    ).toMatchObject({ email: email.toLowerCase() })
  })

  it("drops the obsolete nullable invitation uniqueness constraint", async () => {
    const constraints = await db.execute(sql`
      SELECT conname
      FROM pg_constraint
      WHERE conname = 'membership_invitations_org_id_email_accepted_at_unique'
    `)
    expect(constraints).toHaveLength(0)
    const columns = await db.execute(sql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'outbox_events'
        AND column_name IN ('invitation_id', 'dead_lettered_at')
      ORDER BY column_name
    `)
    expect(
      [...columns].map((row) => ({
        name: row.column_name,
        type: row.data_type,
        nullable: row.is_nullable,
      }))
    ).toEqual([
      {
        name: "dead_lettered_at",
        type: "timestamp with time zone",
        nullable: "YES",
      },
      { name: "invitation_id", type: "text", nullable: "YES" },
    ])
    const constraintsExact = await db.execute(sql`
      SELECT conname, contype, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'outbox_events'::regclass
        AND conname IN (
          'outbox_events_invitation_id_unique',
          'outbox_events_invitation_id_fkey'
        )
      ORDER BY conname
    `)
    expect(
      [...constraintsExact].map((row) => ({
        name: row.conname,
        type: row.contype,
        definition: row.definition,
      }))
    ).toEqual([
      {
        name: "outbox_events_invitation_id_fkey",
        type: "f",
        definition:
          "FOREIGN KEY (invitation_id) REFERENCES membership_invitations(id) ON DELETE CASCADE",
      },
      {
        name: "outbox_events_invitation_id_unique",
        type: "u",
        definition: "UNIQUE (invitation_id)",
      },
    ])
    const indexes = await db.execute(sql`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND indexname IN (
          'outbox_events_pending_idx',
          'outbox_events_active_invitation_lease_idx'
        )
      ORDER BY indexname
    `)
    const definitions = [...indexes].map((row) => String(row.indexdef))
    expect(definitions).toHaveLength(2)
    expect(definitions[0]).toContain(
      "(invitation_id, lease_until) WHERE ((delivered_at IS NULL) AND (dead_lettered_at IS NULL))"
    )
    expect(definitions[1]).toContain(
      "(available_at, created_at) WHERE ((delivered_at IS NULL) AND (dead_lettered_at IS NULL))"
    )
  })
})
