// SPDX-License-Identifier: AGPL-3.0-only
import { Hono } from "hono"
import { z } from "zod"
import { eq } from "drizzle-orm"
import { createDb, apps } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { env } from "../env"
import { getAppForUser } from "@ploydok/db/queries"
import { encryptField, decryptField } from "../github/app-credentials"
import { CaddyClient } from "../caddy/client"
import { childLogger } from "../logger"
import { requireSecondFactor } from "../auth/middleware"
import type { AuthUser } from "../auth/middleware"
import { listDomainsForApp } from "@ploydok/db/queries"
import { CaddyExtraHandlersSchema } from "@ploydok/shared"

const log = childLogger("protection")

// ---------------------------------------------------------------------------
// CIDR validation helper (IPv4 + IPv6 basic check)
// ---------------------------------------------------------------------------

const CIDR_V4 = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/
const CIDR_V6 = /^[0-9a-fA-F:]+\/\d{1,3}$/
const PLAIN_V4 = /^(\d{1,3}\.){3}\d{1,3}$/
const PLAIN_V6 = /^[0-9a-fA-F:]+$/

function isValidCidr(cidr: string): boolean {
  return (
    CIDR_V4.test(cidr) ||
    CIDR_V6.test(cidr) ||
    PLAIN_V4.test(cidr) ||
    PLAIN_V6.test(cidr)
  )
}

// ---------------------------------------------------------------------------
// bcrypt hash for Caddy basic auth
// ---------------------------------------------------------------------------

async function hashPasswordForCaddy(pass: string): Promise<string> {
  // Bun has native bcrypt support
  return Bun.password.hash(pass, { algorithm: "bcrypt", cost: 10 })
}

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const ProtectionPatchBody = z.object({
  basicAuth: z
    .object({
      enabled: z.boolean(),
      user: z.string().min(1).max(255).optional(),
      pass: z.string().min(1).max(255).optional(),
    })
    .optional(),
  ipAllowlist: z.array(z.string()).optional(),
  rateLimitRps: z.number().int().nonnegative().nullable().optional(),
})

// ---------------------------------------------------------------------------
// Caddy sync helper
// ---------------------------------------------------------------------------

const caddyClient = new CaddyClient(
  Bun.env["CADDY_ADMIN_URL"] ?? "http://127.0.0.1:2020"
)

async function syncProtectionToCaddy(
  db: Db,
  app: typeof apps.$inferSelect
): Promise<void> {
  const upstream = await caddyClient.getUpstream(app.id)
  if (!upstream || !app.domain) return

  // Build middlewares from app columns
  const middlewares: Parameters<
    typeof caddyClient.upsertRoute
  >[0]["middlewares"] = {}
  middlewares.cdn = app

  if (
    app.protection_basic_auth_enabled &&
    app.protection_basic_auth_user_enc &&
    app.protection_basic_auth_user_nonce &&
    app.protection_basic_auth_pass_enc &&
    app.protection_basic_auth_pass_nonce
  ) {
    const user = await decryptField(
      app.protection_basic_auth_user_enc,
      app.protection_basic_auth_user_nonce
    )
    const pass = await decryptField(
      app.protection_basic_auth_pass_enc,
      app.protection_basic_auth_pass_nonce
    )
    const passHash = await hashPasswordForCaddy(pass)
    middlewares.basicAuth = { user, pass_hash: passHash }
  }

  if (app.protection_ip_allowlist && app.protection_ip_allowlist.length > 0) {
    middlewares.ipAllowlist = app.protection_ip_allowlist
  }

  if (app.protection_rate_limit_rps && app.protection_rate_limit_rps > 0) {
    middlewares.rateLimit = { rps: app.protection_rate_limit_rps }
  }

  if (app.caddy_extra_handlers) {
    try {
      middlewares.extraHandlers = JSON.parse(app.caddy_extra_handlers)
    } catch {
      log.warn(
        { appId: app.id },
        "caddy: failed to parse caddy_extra_handlers JSON"
      )
    }
  }

  // Sync main app route
  try {
    await caddyClient.upsertRoute({
      host: app.domain,
      upstream: `${upstream.host}:${upstream.port}`,
      appId: app.id,
      middlewares,
    })
  } catch (err) {
    log.warn(
      { err, appId: app.id },
      "caddy: failed to sync protection to main route"
    )
  }

  // Sync custom domain routes
  try {
    const domains = await listDomainsForApp(db, app.id)
    for (const domain of domains) {
      const domainUpstream = await caddyClient.getUpstream(
        `domain-${domain.id}`
      )
      if (!domainUpstream) continue
      await caddyClient.upsertRoute({
        host: domain.hostname,
        upstream: `${domainUpstream.host}:${domainUpstream.port}`,
        appId: `domain-${domain.id}`,
        middlewares,
      })
    }
  } catch (err) {
    log.warn(
      { err, appId: app.id },
      "caddy: failed to sync protection to custom domain routes"
    )
  }
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

function getUser(c: { get: (key: string) => unknown }): AuthUser {
  return c.get("user") as AuthUser
}

export function createAppsProtectionRouter(db: Db): Hono {
  const router = new Hono()
  const sf = requireSecondFactor(db)

  // -------------------------------------------------------------------------
  // GET /:id/protection — current protection config
  // -------------------------------------------------------------------------

  router.get("/:id/protection", async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")

    const app = await getAppForUser(db, appId, user.id)
    if (!app) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "App not found" } },
        404
      )
    }

    const basicAuthUser =
      app.protection_basic_auth_enabled &&
      app.protection_basic_auth_user_enc &&
      app.protection_basic_auth_user_nonce
        ? await decryptField(
            app.protection_basic_auth_user_enc,
            app.protection_basic_auth_user_nonce
          ).catch(() => undefined)
        : undefined

    return c.json({
      basicAuth: {
        enabled: app.protection_basic_auth_enabled,
        user: basicAuthUser ?? null,
      },
      ipAllowlist: app.protection_ip_allowlist ?? [],
      rateLimitRps: app.protection_rate_limit_rps ?? null,
    })
  })

  // -------------------------------------------------------------------------
  // PATCH /:id/protection — update protection settings
  // -------------------------------------------------------------------------

  router.patch("/:id/protection", async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")!

    const app = await getAppForUser(db, appId, user.id)
    if (!app) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "App not found" } },
        404
      )
    }

    let body: z.infer<typeof ProtectionPatchBody>
    try {
      body = ProtectionPatchBody.parse(await c.req.json())
    } catch (err) {
      return c.json(
        { error: { code: "VALIDATION_ERROR", message: String(err) } },
        400
      )
    }

    // Validate CIDR list
    if (body.ipAllowlist) {
      for (const cidr of body.ipAllowlist) {
        if (!isValidCidr(cidr.trim())) {
          return c.json(
            {
              error: {
                code: "VALIDATION_ERROR",
                message: `Invalid CIDR or IP: ${cidr}`,
              },
            },
            400
          )
        }
      }
    }

    // Build update payload
    const patch: Partial<typeof apps.$inferInsert> = {}

    if (body.basicAuth !== undefined) {
      patch.protection_basic_auth_enabled = body.basicAuth.enabled

      if (
        body.basicAuth.enabled &&
        body.basicAuth.user &&
        body.basicAuth.pass
      ) {
        const { enc: userEnc, nonce: userNonce } = await encryptField(
          body.basicAuth.user
        )
        const { enc: passEnc, nonce: passNonce } = await encryptField(
          body.basicAuth.pass
        )
        patch.protection_basic_auth_user_enc = userEnc
        patch.protection_basic_auth_user_nonce = userNonce
        patch.protection_basic_auth_pass_enc = passEnc
        patch.protection_basic_auth_pass_nonce = passNonce
      } else if (!body.basicAuth.enabled) {
        // Clear credentials when disabling
        patch.protection_basic_auth_user_enc = null
        patch.protection_basic_auth_user_nonce = null
        patch.protection_basic_auth_pass_enc = null
        patch.protection_basic_auth_pass_nonce = null
      }
    }

    if (body.ipAllowlist !== undefined) {
      patch.protection_ip_allowlist = body.ipAllowlist
        .map((c) => c.trim())
        .filter(Boolean)
    }

    if (body.rateLimitRps !== undefined) {
      patch.protection_rate_limit_rps = body.rateLimitRps ?? null
    }

    patch.updated_at = new Date()

    const [updated] = await db
      .update(apps)
      .set(patch)
      .where(eq(apps.id, appId))
      .returning()

    if (!updated) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "App not found" } },
        404
      )
    }

    // Best-effort Caddy sync
    void syncProtectionToCaddy(db, updated)

    return c.json({
      basicAuth: {
        enabled: updated.protection_basic_auth_enabled,
        user: body.basicAuth?.user ?? null,
      },
      ipAllowlist: updated.protection_ip_allowlist ?? [],
      rateLimitRps: updated.protection_rate_limit_rps ?? null,
    })
  })

  // -------------------------------------------------------------------------
  // POST /:id/protection/basic-auth/reveal — reveal plaintext credentials
  // -------------------------------------------------------------------------

  router.post("/:id/protection/basic-auth/reveal", sf, async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")!

    const app = await getAppForUser(db, appId, user.id)
    if (!app) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "App not found" } },
        404
      )
    }

    if (
      !app.protection_basic_auth_enabled ||
      !app.protection_basic_auth_user_enc ||
      !app.protection_basic_auth_user_nonce ||
      !app.protection_basic_auth_pass_enc ||
      !app.protection_basic_auth_pass_nonce
    ) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Basic auth not configured" } },
        404
      )
    }

    const username = await decryptField(
      app.protection_basic_auth_user_enc,
      app.protection_basic_auth_user_nonce
    )
    const password = await decryptField(
      app.protection_basic_auth_pass_enc,
      app.protection_basic_auth_pass_nonce
    )

    return c.json({ user: username, pass: password })
  })

  // -------------------------------------------------------------------------
  // GET /:id/caddy-extra — current Caddy extra handlers config
  // -------------------------------------------------------------------------

  router.get("/:id/caddy-extra", async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")

    const app = await getAppForUser(db, appId, user.id)
    if (!app) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "App not found" } },
        404
      )
    }

    let handlers = null
    if (app.caddy_extra_handlers) {
      try {
        handlers = JSON.parse(app.caddy_extra_handlers)
      } catch {
        handlers = null
      }
    }

    return c.json({ handlers })
  })

  // -------------------------------------------------------------------------
  // PATCH /:id/caddy-extra — update custom Caddy handlers
  // -------------------------------------------------------------------------

  router.patch("/:id/caddy-extra", async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")!

    const app = await getAppForUser(db, appId, user.id)
    if (!app) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "App not found" } },
        404
      )
    }

    let body: { handlers: unknown }
    try {
      body = await c.req.json()
    } catch (err) {
      return c.json(
        { error: { code: "VALIDATION_ERROR", message: String(err) } },
        400
      )
    }

    let parsed = null
    if (body.handlers !== null && body.handlers !== undefined) {
      const result = CaddyExtraHandlersSchema.safeParse(body.handlers)
      if (!result.success) {
        return c.json(
          {
            error: { code: "VALIDATION_ERROR", message: result.error.message },
          },
          400
        )
      }
      parsed = result.data
    }

    const patch: Partial<typeof apps.$inferInsert> = {
      caddy_extra_handlers: parsed ? JSON.stringify(parsed) : null,
      updated_at: new Date(),
    }

    const [updated] = await db
      .update(apps)
      .set(patch)
      .where(eq(apps.id, appId))
      .returning()

    if (!updated) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "App not found" } },
        404
      )
    }

    // Best-effort Caddy sync
    void syncProtectionToCaddy(db, updated)

    return c.json({ handlers: parsed })
  })

  return router
}

// ---------------------------------------------------------------------------
// Prod singleton
// ---------------------------------------------------------------------------

const prodDb = createDb(env.DATABASE_URL)
export const appsProtectionRouter = createAppsProtectionRouter(prodDb)
