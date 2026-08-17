// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Workspace deployment aggregation queries against Postgres.
 * Requires PLOYDOK_TEST_PG_URL — skipped when the integration database is absent.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { join } from "node:path"
import { nanoid } from "nanoid"
import postgres from "postgres"
import { createDb } from "../client"
import { apps, builds, projects, users } from "../schema"
import { listOrganizationDeployments } from "./organization-deployments"

const PG_URL = Bun.env["PLOYDOK_TEST_PG_URL"]
const MIGRATIONS_DIR = join(import.meta.dir, "../../migrations")
const skip = !PG_URL

if (skip) {
  console.log(
    "[organization-deployments.test] PLOYDOK_TEST_PG_URL not set — skipping Postgres tests"
  )
}

describe.skipIf(skip)("organization deployment queries", () => {
  const db = createDb(PG_URL!)
  let sql: ReturnType<typeof postgres>
  const suffix = nanoid(8)
  const userOneId = `org-deploy-user-one-${suffix}`
  const userTwoId = `org-deploy-user-two-${suffix}`
  const orgOneId = `org-deploy-org-one-${suffix}`
  const orgTwoId = `org-deploy-org-two-${suffix}`
  const apiAppId = `org-deploy-api-${suffix}`
  const workerAppId = `org-deploy-worker-${suffix}`
  const otherAppId = `org-deploy-other-${suffix}`

  beforeAll(async () => {
    sql = postgres(PG_URL!, { max: 1 })
    await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS_DIR })
    const now = new Date()

    await db.insert(users).values([
      {
        id: userOneId,
        email: `${userOneId}@example.test`,
        display_name: "Workspace one",
        created_at: now,
        updated_at: now,
        recovery_token_hash: null,
        recovery_expires_at: null,
      },
      {
        id: userTwoId,
        email: `${userTwoId}@example.test`,
        display_name: "Workspace two",
        created_at: now,
        updated_at: now,
        recovery_token_hash: null,
        recovery_expires_at: null,
      },
    ])
    await db.insert(projects).values([
      {
        id: orgOneId,
        owner_id: userOneId,
        name: "Workspace one",
        slug: `workspace-one-${suffix}`,
        created_at: now,
      },
      {
        id: orgTwoId,
        owner_id: userTwoId,
        name: "Workspace two",
        slug: `workspace-two-${suffix}`,
        created_at: now,
      },
    ])
    await db.insert(apps).values([
      {
        id: apiAppId,
        project_id: orgOneId,
        name: "API service",
        slug: `api-${suffix}`,
        created_at: now,
        updated_at: now,
      },
      {
        id: workerAppId,
        project_id: orgOneId,
        name: "Worker service",
        slug: `worker-${suffix}`,
        created_at: now,
        updated_at: now,
      },
      {
        id: otherAppId,
        project_id: orgTwoId,
        name: "Other workspace app",
        slug: `other-${suffix}`,
        created_at: now,
        updated_at: now,
      },
    ])
    await db.insert(builds).values([
      {
        id: `org-deploy-old-${suffix}`,
        app_id: apiAppId,
        status: "succeeded",
        source: "api",
        commit_sha: "api-old-sha",
        commit_message: "Initial API release",
        created_at: new Date("2026-01-01T08:00:00.000Z"),
      },
      {
        id: `org-deploy-new-a-${suffix}`,
        app_id: apiAppId,
        status: "failed",
        source: "webhook:github",
        commit_sha: "api-failure-sha",
        commit_message: "Fix API deployment",
        created_at: new Date("2026-01-02T08:00:00.000Z"),
      },
      {
        id: `org-deploy-new-z-${suffix}`,
        app_id: workerAppId,
        status: "running",
        source: "api",
        commit_sha: "worker-sha",
        commit_message: "Deploy worker",
        created_at: new Date("2026-01-02T08:00:00.000Z"),
      },
      {
        id: `org-deploy-other-${suffix}`,
        app_id: otherAppId,
        status: "succeeded",
        source: "api",
        commit_sha: "other-sha",
        commit_message: "This must not leak",
        created_at: new Date("2026-01-03T08:00:00.000Z"),
      },
    ])
  })

  afterAll(async () => {
    await db
      .delete(users)
      .where(eq(users.id, userOneId))
      .catch(() => {})
    await db
      .delete(users)
      .where(eq(users.id, userTwoId))
      .catch(() => {})
    await sql.end()
  })

  it("isolates builds to the workspace and returns stable newest-first ordering", async () => {
    const result = await listOrganizationDeployments(db, orgOneId, {
      page: 1,
      pageSize: 20,
    })

    expect(result.total).toBe(3)
    expect(result.deployments.map((row) => row.build.app_id).sort()).toEqual(
      [apiAppId, apiAppId, workerAppId].sort()
    )
    expect(result.deployments.map((row) => row.app.name)).not.toContain(
      "Other workspace app"
    )
    expect(result.deployments[0]?.build.id).toBe(`org-deploy-new-z-${suffix}`)
    expect(result.deployments[1]?.build.id).toBe(`org-deploy-new-a-${suffix}`)
    expect(result.summary).toMatchObject({
      total: 3,
      succeeded: 1,
      failed: 1,
      running: 1,
    })
  })

  it("applies filters and paginates within the workspace", async () => {
    const filtered = await listOrganizationDeployments(db, orgOneId, {
      page: 1,
      pageSize: 20,
      appId: apiAppId,
      source: "webhook:github",
      q: "failure",
      from: new Date("2026-01-02T00:00:00.000Z"),
      to: new Date("2026-01-02T23:59:59.999Z"),
    })
    expect(filtered.total).toBe(1)
    expect(filtered.deployments[0]?.build.id).toBe(`org-deploy-new-a-${suffix}`)

    const page = await listOrganizationDeployments(db, orgOneId, {
      page: 2,
      pageSize: 2,
    })
    expect(page.total).toBe(3)
    expect(page.deployments).toHaveLength(1)
    expect(page.deployments[0]?.build.id).toBe(`org-deploy-old-${suffix}`)
  })
})
