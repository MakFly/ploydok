// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Durable Stripe replay guard integration tests.
 *
 * Requires PLOYDOK_TEST_PG_URL and is skipped when PostgreSQL is unavailable.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { like } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { nanoid } from "nanoid"
import postgres from "postgres"
import { createDb } from "../client"
import { stripe_webhook_events } from "../schema"
import {
  claimStripeWebhookEvent,
  completeStripeWebhookEvent,
  releaseStripeWebhookEvent,
} from "./stripe-webhook-events"

const PG_URL = Bun.env["PLOYDOK_TEST_PG_URL"]
const MIGRATIONS_DIR = `${import.meta.dir}/../../migrations`
const skip = !PG_URL
const prefix = `stripe-replay-${nanoid(8)}`

if (skip) {
  console.log(
    "[stripe-webhook-events.test] PLOYDOK_TEST_PG_URL not set — skipping Postgres tests"
  )
}

describe.skipIf(skip)("Stripe webhook event claims", () => {
  const db = createDb(PG_URL!)
  let migrationSql: ReturnType<typeof postgres>

  beforeAll(async () => {
    migrationSql = postgres(PG_URL!, { max: 1 })
    await migrate(drizzle(migrationSql), { migrationsFolder: MIGRATIONS_DIR })
  })

  afterAll(async () => {
    await db
      .delete(stripe_webhook_events)
      .where(like(stripe_webhook_events.event_id, `${prefix}%`))
      .catch(() => {})
    await migrationSql.end()
  })

  it("allows only one concurrent claimant and rejects the completed replay", async () => {
    const event = { id: `${prefix}-once`, type: "invoice.payment_failed" }
    const now = new Date("2026-08-18T10:00:00.000Z")

    const claims = await Promise.all([
      claimStripeWebhookEvent(db, event, {
        now,
        leaseToken: "worker-a",
      }),
      claimStripeWebhookEvent(db, event, {
        now,
        leaseToken: "worker-b",
      }),
    ])

    const winner = claims.find((claim) => claim.status === "claimed")
    expect(claims.filter((claim) => claim.status === "claimed")).toHaveLength(1)
    expect(claims.filter((claim) => claim.status === "busy")).toHaveLength(1)
    expect(winner?.status).toBe("claimed")
    if (!winner || winner.status !== "claimed")
      throw new Error("missing winner")

    expect(
      await completeStripeWebhookEvent(db, event.id, winner.leaseToken, now)
    ).toBe(true)
    expect(await claimStripeWebhookEvent(db, event, { now })).toEqual({
      status: "processed",
    })
  })

  it("releases a failed claim for the next retry", async () => {
    const event = { id: `${prefix}-failed`, type: "invoice.payment_failed" }
    const now = new Date("2026-08-18T10:00:00.000Z")
    const first = await claimStripeWebhookEvent(db, event, {
      now,
      leaseToken: "failed-worker",
    })
    expect(first.status).toBe("claimed")

    expect(
      await releaseStripeWebhookEvent(
        db,
        event.id,
        "failed-worker",
        "temporary database failure",
        now
      )
    ).toBe(true)

    expect(
      await claimStripeWebhookEvent(db, event, {
        now,
        leaseToken: "retry-worker",
      })
    ).toEqual({ status: "claimed", leaseToken: "retry-worker" })
  })

  it("recovers an expired crash lease and fences the stale worker", async () => {
    const event = { id: `${prefix}-crash`, type: "invoice.payment_failed" }
    const startedAt = new Date("2026-08-18T10:00:00.000Z")
    const afterExpiry = new Date("2026-08-18T10:00:02.000Z")

    expect(
      await claimStripeWebhookEvent(db, event, {
        now: startedAt,
        leaseMs: 1_000,
        leaseToken: "crashed-worker",
      })
    ).toEqual({ status: "claimed", leaseToken: "crashed-worker" })
    expect(
      await claimStripeWebhookEvent(db, event, {
        now: afterExpiry,
        leaseToken: "recovery-worker",
      })
    ).toEqual({ status: "claimed", leaseToken: "recovery-worker" })

    expect(
      await completeStripeWebhookEvent(
        db,
        event.id,
        "crashed-worker",
        afterExpiry
      )
    ).toBe(false)
    expect(
      await completeStripeWebhookEvent(
        db,
        event.id,
        "recovery-worker",
        afterExpiry
      )
    ).toBe(true)
  })
})
