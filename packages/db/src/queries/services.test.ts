// SPDX-License-Identifier: AGPL-3.0-only
/**
 * services.test.ts — services queries against Postgres
 *
 * Requires PLOYDOK_TEST_PG_URL — skipped if absent.
 */
import { beforeAll, afterAll, describe, expect, it } from "bun:test"
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { join } from "node:path"
import { eq } from "drizzle-orm"
import { nanoid } from "nanoid"
import { createDb } from "../client"
import { projects, services, users } from "../schema"
import {
  getServiceById,
  getServiceForUser,
  insertService,
  listServicesForProject,
  markServiceDeleting,
  uniqueServiceSlug,
  updateServiceContainers,
  updateServiceStatus,
} from "./services"

const PG_URL = Bun.env["PLOYDOK_TEST_PG_URL"]
const MIGRATIONS_DIR = join(import.meta.dir, "../../migrations")

const skip = !PG_URL
if (skip) {
  console.log(
    "[services.test] PLOYDOK_TEST_PG_URL not set — skipping Postgres tests"
  )
}

describe.skipIf(skip)("services queries", () => {
  const db = createDb(PG_URL!)
  let sql: ReturnType<typeof postgres>

  let userId: string
  let projectId: string

  beforeAll(async () => {
    sql = postgres(PG_URL!, { max: 1 })
    const migDb = drizzle(sql)
    await migrate(migDb, { migrationsFolder: MIGRATIONS_DIR })

    const now = new Date()
    userId = `svc-user-${nanoid(6)}`
    projectId = `svc-proj-${nanoid(6)}`

    await db
      .insert(users)
      .values({
        id: userId,
        email: `services-test-${userId}@example.com`,
        display_name: "Test User",
        created_at: now,
        updated_at: now,
        recovery_token_hash: null,
        recovery_expires_at: null,
      })
      .onConflictDoNothing()

    await db
      .insert(projects)
      .values({
        id: projectId,
        owner_id: userId,
        name: "Test Project",
        slug: `slug-${projectId}`,
        created_at: now,
      })
      .onConflictDoNothing()
  })

  afterAll(async () => {
    await db
      .delete(users)
      .where(eq(users.id, userId))
      .catch(() => {})
    await sql.end()
  })

  it("inserts a service and retrieves it by id", async () => {
    const id = `svc-${nanoid(8)}`
    const row = await insertService(db, {
      id,
      project_id: projectId,
      name: "PocketBase",
      slug: "pocketbase",
      template_id: "pocketbase",
      template_version: "0.22.0",
      compose_raw: "version: '3'\nservices:\n  app:\n    image: pocketbase",
      generated_env: { ADMIN_EMAIL: "admin@example.com" },
    })

    expect(row).not.toBeNull()
    expect(row.id).toBe(id)
    expect(row.project_id).toBe(projectId)
    expect(row.name).toBe("PocketBase")
    expect(row.slug).toBe("pocketbase")
    expect(row.template_id).toBe("pocketbase")
    expect(row.status).toBe("created")
  })

  it("getServiceById returns null for unknown id", async () => {
    const result = await getServiceById(db, "does-not-exist")
    expect(result).toBeNull()
  })

  it("getServiceById returns the row for known id", async () => {
    const id = `svc-${nanoid(8)}`
    await insertService(db, {
      id,
      project_id: projectId,
      name: "Umami",
      slug: `umami-${id}`,
      template_id: "umami",
      compose_raw: "version: '3'",
      generated_env: {},
    })

    const found = await getServiceById(db, id)
    expect(found).not.toBeNull()
    expect(found!.id).toBe(id)
  })

  it("listServicesForProject returns all services for the project", async () => {
    const localProjectId = `svc-proj-list-${nanoid(6)}`
    await db
      .insert(projects)
      .values({
        id: localProjectId,
        owner_id: userId,
        name: "List Project",
        slug: `slug-${localProjectId}`,
        created_at: new Date(),
      })
      .onConflictDoNothing()

    const ids = [`svc-${nanoid(8)}`, `svc-${nanoid(8)}`]
    for (const [i, id] of ids.entries()) {
      await insertService(db, {
        id,
        project_id: localProjectId,
        name: `Service ${i}`,
        slug: `svc-${i}-${id}`,
        template_id: "n8n",
        compose_raw: "version: '3'",
        generated_env: {},
      })
    }

    const list = await listServicesForProject(db, localProjectId)
    expect(list.length).toBe(2)
  })

  it("getServiceForUser returns null when user does not own the project", async () => {
    const id = `svc-${nanoid(8)}`
    await insertService(db, {
      id,
      project_id: projectId,
      name: "Private",
      slug: `private-${id}`,
      template_id: "pocketbase",
      compose_raw: "version: '3'",
      generated_env: {},
    })

    const result = await getServiceForUser(db, id, "other-user-id")
    expect(result).toBeNull()
  })

  it("getServiceForUser returns the row for the actual owner", async () => {
    const id = `svc-${nanoid(8)}`
    await insertService(db, {
      id,
      project_id: projectId,
      name: "Owned",
      slug: `owned-${id}`,
      template_id: "umami",
      compose_raw: "version: '3'",
      generated_env: {},
    })

    const result = await getServiceForUser(db, id, userId)
    expect(result).not.toBeNull()
    expect(result!.id).toBe(id)
  })

  it("updateServiceStatus changes the status", async () => {
    const id = `svc-${nanoid(8)}`
    await insertService(db, {
      id,
      project_id: projectId,
      name: "Status Test",
      slug: `status-${id}`,
      template_id: "pocketbase",
      compose_raw: "version: '3'",
      generated_env: {},
    })

    await updateServiceStatus(db, id, "running")
    const row = await getServiceById(db, id)
    expect(row!.status).toBe("running")
  })

  it("updateServiceContainers persists container ids", async () => {
    const id = `svc-${nanoid(8)}`
    await insertService(db, {
      id,
      project_id: projectId,
      name: "Container Test",
      slug: `container-${id}`,
      template_id: "n8n",
      compose_raw: "version: '3'",
      generated_env: {},
    })

    await updateServiceContainers(db, id, ["abc123", "def456"])
    const row = await getServiceById(db, id)
    expect(row!.container_ids).toEqual(["abc123", "def456"])
  })

  it("markServiceDeleting sets status to deleting", async () => {
    const id = `svc-${nanoid(8)}`
    await insertService(db, {
      id,
      project_id: projectId,
      name: "Deleting Test",
      slug: `deleting-${id}`,
      template_id: "umami",
      compose_raw: "version: '3'",
      generated_env: {},
    })

    await markServiceDeleting(db, id)
    const row = await getServiceById(db, id)
    expect(row!.status).toBe("deleting")
  })

  it("uniqueServiceSlug returns base slug when no conflict", async () => {
    const slug = await uniqueServiceSlug(db, projectId, "my-unique-svc")
    expect(slug).toBe("my-unique-svc")
  })

  it("uniqueServiceSlug increments on conflict", async () => {
    const base = `conflict-svc-${nanoid(4)}`
    const id1 = `svc-${nanoid(8)}`
    await insertService(db, {
      id: id1,
      project_id: projectId,
      name: "Conflict 1",
      slug: base,
      template_id: "pocketbase",
      compose_raw: "version: '3'",
      generated_env: {},
    })

    const slug = await uniqueServiceSlug(db, projectId, base)
    expect(slug).toBe(`${base}-2`)
  })

  it("uniqueServiceSlug excludes own id from conflict check", async () => {
    const base = `excl-svc-${nanoid(4)}`
    const id = `svc-${nanoid(8)}`
    await insertService(db, {
      id,
      project_id: projectId,
      name: "Exclude Self",
      slug: base,
      template_id: "umami",
      compose_raw: "version: '3'",
      generated_env: {},
    })

    const slug = await uniqueServiceSlug(db, projectId, base, id)
    expect(slug).toBe(base)
  })

  it("FK cascade: services deleted when project deleted", async () => {
    const localProjectId = `svc-proj-cascade-${nanoid(6)}`
    await db
      .insert(projects)
      .values({
        id: localProjectId,
        owner_id: userId,
        name: "Cascade Project",
        slug: `slug-${localProjectId}`,
        created_at: new Date(),
      })
      .onConflictDoNothing()

    const id = `svc-${nanoid(8)}`
    await insertService(db, {
      id,
      project_id: localProjectId,
      name: "To Cascade",
      slug: "cascade-svc",
      template_id: "pocketbase",
      compose_raw: "version: '3'",
      generated_env: {},
    })

    const before = await getServiceById(db, id)
    expect(before).not.toBeNull()

    await db.delete(projects).where(eq(projects.id, localProjectId))

    const after = await getServiceById(db, id)
    expect(after).toBeNull()
  })
})
