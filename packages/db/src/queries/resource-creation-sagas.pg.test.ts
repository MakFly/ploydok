// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { eq } from "drizzle-orm"
import { nanoid } from "nanoid"
import postgres from "postgres"
import { createDb } from "../client"
import { projects, resource_creation_sagas, users } from "../schema"
import {
  beginCreationSagaAttempt,
  claimCreationSaga,
  completeCreationSaga,
  createCreationSaga,
  failCreationSaga,
  getCreationSaga,
  fenceCreationSaga,
  recordCreationSagaStep,
  retryClaimedCreationSaga,
} from "./resource-creation-sagas"

const PG_URL = Bun.env["PLOYDOK_TEST_PG_URL"]
const skip = !PG_URL
const prefix = `creation-saga-${nanoid(8)}`

if (skip)
  console.log(
    "[resource-creation-sagas.pg.test] PLOYDOK_TEST_PG_URL not set — skipping"
  )

describe.skipIf(skip)("resource creation sagas PostgreSQL durability", () => {
  const db = createDb(PG_URL!)
  let migrationSql: ReturnType<typeof postgres>
  const ownerId = `${prefix}-owner`
  const projectId = `${prefix}-project`

  beforeAll(async () => {
    migrationSql = postgres(PG_URL!, { max: 1 })
    await migrate(drizzle(migrationSql), {
      migrationsFolder: `${import.meta.dir}/../../migrations`,
    })
    const now = new Date()
    await db.insert(users).values({
      id: ownerId,
      email: `${prefix}@example.com`,
      display_name: "Creation saga owner",
      created_at: now,
      updated_at: now,
    })
    await db.insert(projects).values({
      id: projectId,
      owner_id: ownerId,
      name: "Creation saga test",
      slug: projectId,
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

  it("persists crash state and resumes only missing idempotent steps", async () => {
    const resourceId = `${prefix}-database`
    await createCreationSaga(db, {
      resourceType: "database",
      resourceId,
      projectId,
      requestedByUserId: ownerId,
      completedSteps: ["row_persisted"],
    })
    await beginCreationSagaAttempt(db, "database", resourceId)
    await recordCreationSagaStep(
      db,
      "database",
      resourceId,
      "container_created",
      {
        containerId: `${prefix}-container`,
        volumeName: `${prefix}-volume`,
      }
    )
    await failCreationSaga(
      db,
      "database",
      resourceId,
      new Error("simulated crash")
    )

    let saga = await getCreationSaga(db, "database", resourceId)
    expect(saga?.state).toBe("failed")
    expect(saga?.owned_resources.containerId).toBe(`${prefix}-container`)

    await beginCreationSagaAttempt(db, "database", resourceId)
    await recordCreationSagaStep(
      db,
      "database",
      resourceId,
      "container_created"
    )
    await recordCreationSagaStep(db, "database", resourceId, "route_ready", {
      routeId: `${prefix}-route`,
    })
    await completeCreationSaga(db, "database", resourceId)

    saga = await getCreationSaga(db, "database", resourceId)
    expect(saga?.state).toBe("complete")
    expect(saga?.attempt_count).toBe(2)
    expect(
      saga?.completed_steps.filter((step) => step === "container_created")
    ).toHaveLength(1)
    expect(saga?.owned_resources.routeId).toBe(`${prefix}-route`)
  })

  it("keeps creation idempotent under concurrent inserts", async () => {
    const resourceId = `${prefix}-application`
    await Promise.all([
      createCreationSaga(db, {
        resourceType: "application",
        resourceId,
        projectId,
      }),
      createCreationSaga(db, {
        resourceType: "application",
        resourceId,
        projectId,
      }),
    ])
    const rows = await db
      .select({ id: resource_creation_sagas.id })
      .from(resource_creation_sagas)
      .where(eq(resource_creation_sagas.resource_id, resourceId))
    expect(rows).toHaveLength(1)
  })

  it("grants one execution lease, fences stale tokens and releases retry", async () => {
    const resourceId = `${prefix}-leased-application`
    await createCreationSaga(db, {
      resourceType: "application",
      resourceId,
      projectId,
      requestedByUserId: ownerId,
    })
    const now = new Date()
    const [a, b] = await Promise.all([
      claimCreationSaga(db, "application", resourceId, {
        now,
        token: `${prefix}-lease-a`,
      }),
      claimCreationSaga(db, "application", resourceId, {
        now,
        token: `${prefix}-lease-b`,
      }),
    ])
    const winner = a ?? b
    expect([a, b].filter(Boolean)).toHaveLength(1)
    expect(winner).not.toBeNull()
    expect(
      await fenceCreationSaga(
        db,
        "application",
        resourceId,
        `${prefix}-stale`,
        { now }
      )
    ).toBe(false)
    expect(
      await fenceCreationSaga(db, "application", resourceId, winner!.token, {
        now,
      })
    ).toBe(true)

    const retryAt = new Date(now.getTime() + 1_000)
    expect(
      await retryClaimedCreationSaga(
        db,
        "application",
        resourceId,
        winner!.token,
        new Error("retry me"),
        retryAt,
        now
      )
    ).toBe(true)
    expect(
      await claimCreationSaga(db, "application", resourceId, {
        now,
        token: `${prefix}-too-early`,
      })
    ).toBeNull()
    expect(
      await claimCreationSaga(db, "application", resourceId, {
        now: retryAt,
        token: `${prefix}-retry-owner`,
      })
    ).not.toBeNull()
  })
})
