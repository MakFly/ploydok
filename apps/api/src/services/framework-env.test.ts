// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "bun:test"
import { eq } from "drizzle-orm"
import { nanoid } from "nanoid"
import { apps, env_vars, projects, secrets, users } from "@ploydok/db"
import { classifyStack } from "@ploydok/shared"
import { makeTestDb, TEST_PG_URL } from "../test/db-helpers"
import { decryptSecret, encryptSecret } from "../secrets/crypto"
import {
  ensureFrameworkEnvVars,
  generateLaravelAppKey,
  sanitizeFrameworkEnvValues,
  sanitizeLaravelEnvValues,
  suggestedEnvForFramework,
} from "./framework-env"

describe("framework env guardrails", () => {
  it("generates Laravel-compatible APP_KEY values", () => {
    expect(generateLaravelAppKey()).toMatch(/^base64:[A-Za-z0-9+/]+=*$/)
  })

  it("adds APP_KEY to Laravel suggestions", () => {
    const classification = classifyStack({
      "composer.json": true,
      artisan: true,
    })

    const suggested = suggestedEnvForFramework(classification)

    expect(suggested.SESSION_DRIVER).toBe("file")
    expect(suggested.CACHE_STORE).toBe("file")
    expect(suggested.APP_KEY).toMatch(/^base64:[A-Za-z0-9+/]+=*$/)
  })

  it("does not add APP_KEY to non-Laravel suggestions", () => {
    const classification = classifyStack({ "package.json": true })

    const suggested = suggestedEnvForFramework(classification)

    expect(suggested.APP_KEY).toBeUndefined()
  })

  it("keeps Symfony runtime env explicit", () => {
    const classification = classifyStack({
      "composer.json": true,
      "symfony.lock": true,
    })

    const suggested = suggestedEnvForFramework(classification)

    expect(suggested.APP_ENV).toBe("prod")
    expect(suggested.APP_DEBUG).toBe("0")
    expect(suggested.APP_SECRET).toMatch(/^[a-f0-9]{64}$/)
  })

  it("adds Hono Node runtime/build guardrails", () => {
    const classification = classifyStack({
      "package.json": true,
    })
    const honoClassification = {
      ...classification,
      stack: "hono" as const,
      framework: "Hono",
      suggestedEnvVars: {
        NIXPACKS_NODE_VERSION: "22",
        HOSTNAME: "0.0.0.0",
      },
    }

    const suggested = suggestedEnvForFramework(honoClassification)

    expect(suggested.NIXPACKS_NODE_VERSION).toBe("22")
    expect(suggested.HOSTNAME).toBe("0.0.0.0")
  })

  it("repairs Laravel zero-config SQLite env values", () => {
    const result = sanitizeLaravelEnvValues({
      APP_KEY: "",
      DB_CONNECTION: "sqlite",
      SESSION_DRIVER: "database",
      CACHE_STORE: "database",
    })

    expect(result.values.APP_KEY).toMatch(/^base64:[A-Za-z0-9+/]+=*$/)
    expect(result.values.SESSION_DRIVER).toBe("file")
    expect(result.values.CACHE_STORE).toBe("file")
    expect(result.repaired).toEqual([
      "APP_KEY",
      "SESSION_DRIVER",
      "CACHE_STORE",
    ])
  })

  it("keeps database-backed Laravel drivers when an external database is configured", () => {
    const result = sanitizeLaravelEnvValues({
      APP_KEY: "base64:already-valid",
      DB_CONNECTION: "pgsql",
      DB_HOST: "postgres",
      SESSION_DRIVER: "database",
      CACHE_STORE: "database",
    })

    expect(result.values.SESSION_DRIVER).toBe("database")
    expect(result.values.CACHE_STORE).toBe("database")
    expect(result.repaired).toEqual([])
  })

  it("repairs empty Symfony and secret-key-base values", () => {
    const symfony = sanitizeFrameworkEnvValues(
      classifyStack({ "composer.json": true, "symfony.lock": true }),
      { APP_SECRET: "" }
    )
    expect(symfony.values.APP_SECRET).toMatch(/^[a-f0-9]{64}$/)
    expect(symfony.repaired).toContain("APP_SECRET")

    const rails = sanitizeFrameworkEnvValues(
      {
        stack: "ruby",
        framework: "Rails",
        confidence: "high",
        signals: ["Gemfile"],
        recommendedBuild: "nixpacks",
        warnings: [],
        suggestedEnvVars: {},
      },
      { SECRET_KEY_BASE: "" }
    )
    expect(rails.values.SECRET_KEY_BASE).toMatch(/^[a-f0-9]{64}$/)
    expect(rails.repaired).toContain("SECRET_KEY_BASE")
  })
})

describe.skipIf(!TEST_PG_URL)("framework env guardrails with database", () => {
  async function createAppFixture() {
    const { db } = await makeTestDb()
    const now = new Date()
    const userId = nanoid()
    const projectId = nanoid()
    const appId = nanoid()

    await db.insert(users).values({
      id: userId,
      email: `user-${userId}@test.com`,
      display_name: "Test User",
      created_at: now,
      updated_at: now,
    })
    await db.insert(projects).values({
      id: projectId,
      owner_id: userId,
      name: `Project ${projectId}`,
      slug: `project-${projectId}`,
      created_at: now,
    })
    await db.insert(apps).values({
      id: appId,
      project_id: projectId,
      name: "Laravel App",
      slug: `laravel-${appId}`,
      status: "created",
    })

    return { db, appId, projectId }
  }

  it("repairs an existing empty Laravel APP_KEY secret", async () => {
    const { db, appId, projectId } = await createAppFixture()
    const { enc, nonce } = await encryptSecret("")
    const secretId = nanoid()
    await db.insert(secrets).values({
      id: secretId,
      app_id: appId,
      project_id: projectId,
      scope: "shared",
      phase: "runtime",
      key: "APP_KEY",
      value_ciphertext: enc,
      nonce,
      created_at: new Date(),
    })

    const result = await ensureFrameworkEnvVars({
      db,
      appId,
      projectId,
      classification: classifyStack({ "composer.json": true, artisan: true }),
    })

    expect(result.repaired).toContain("APP_KEY")
    const [row] = await db
      .select()
      .from(secrets)
      .where(eq(secrets.id, secretId))
    const value = await decryptSecret(row!.value_ciphertext, row!.nonce)
    expect(value).toMatch(/^base64:[A-Za-z0-9+/]+=*$/)
  })

  it("repairs an existing empty Laravel APP_KEY env var", async () => {
    const { db, appId, projectId } = await createAppFixture()
    const envId = nanoid()
    await db.insert(env_vars).values({
      id: envId,
      app_id: appId,
      key: "APP_KEY",
      value: "",
      secret: true,
    })

    const result = await ensureFrameworkEnvVars({
      db,
      appId,
      projectId,
      classification: classifyStack({ "composer.json": true, artisan: true }),
    })

    expect(result.repaired).toContain("APP_KEY")
    const [row] = await db
      .select()
      .from(env_vars)
      .where(eq(env_vars.id, envId))
    expect(row!.value).toMatch(/^base64:[A-Za-z0-9+/]+=*$/)
  })
})
