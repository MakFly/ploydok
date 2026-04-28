// SPDX-License-Identifier: AGPL-3.0-only
import { Hono } from "hono"
import { and, eq } from "drizzle-orm"
import {
  app_cloudflare_cdn,
  apps,
  cloudflare_connections,
  type Db,
} from "@ploydok/db"
import { getAppForUser, listDomainsForApp } from "@ploydok/db/queries"
import {
  CdnConfigSchema,
  CloudflareManagedCdnSchema,
  type CdnConfig,
  type CloudflareManagedCdn,
  type CloudflareManagedCdnStatus,
} from "@ploydok/shared"
import { nanoid } from "nanoid"
import type { AuthUser } from "../auth/middleware"
import { CaddyClient } from "../caddy/client"
import { CloudflareClient, type CloudflareFetch } from "../cloudflare/client"
import { decryptField, encryptField } from "../github/app-credentials"
import { caddyStaticRootForApp } from "../worker/handlers/build-static"

function getUser(c: { get: (key: string) => unknown }): AuthUser {
  return c.get("user") as AuthUser
}

export interface CdnRouterOptions {
  cloudflareFetch?: CloudflareFetch
}

const caddyClient = new CaddyClient(
  Bun.env["CADDY_ADMIN_URL"] ?? "http://127.0.0.1:2020"
)

function parseHeaderConfig(value: string | null): Record<string, string> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {}
    }
    const headers: Record<string, string> = {}
    for (const [key, headerValue] of Object.entries(parsed)) {
      if (typeof headerValue === "string") headers[key] = headerValue
    }
    return headers
  } catch {
    return {}
  }
}

function serializeCdnConfig(app: typeof apps.$inferSelect): CdnConfig {
  return {
    mode: app.cdn_mode,
    cache_ttl_s: app.cdn_cache_ttl_s ?? 300,
    cache_paths: app.cdn_cache_paths ?? [],
    compression: app.cdn_compression,
    image_optim: app.cdn_image_optim,
    headers: parseHeaderConfig(app.cdn_headers),
    external_provider:
      app.cdn_external_provider === "cloudflare" ? "cloudflare" : null,
  }
}

async function syncCdnToCaddy(
  db: Db,
  app: typeof apps.$inferSelect
): Promise<void> {
  if (!app.domain) return

  if (app.build_method === "static") {
    await caddyClient.upsertStaticRoute({
      appId: app.id,
      host: app.domain,
      root: caddyStaticRootForApp(app.id),
      spaFallback: app.static_spa_fallback,
      cdn: app,
    })
    return
  }

  const upstream =
    (await caddyClient.getUpstream(app.id)) ??
    (app.container_id
      ? {
          host: app.container_id,
          port: app.healthcheck_port ?? app.runtime_port ?? 3000,
        }
      : null)

  if (!upstream) return

  await caddyClient.setUpstream(
    app.id,
    app.domain,
    { host: upstream.host, port: upstream.port },
    { cdn: app }
  )

  const domains = await listDomainsForApp(db, app.id)
  for (const domain of domains) {
    const domainUpstream = await caddyClient.getUpstream(`domain-${domain.id}`)
    if (!domainUpstream) continue
    await caddyClient.upsertRoute({
      host: domain.hostname,
      upstream: `${domainUpstream.host}:${domainUpstream.port}`,
      appId: `domain-${domain.id}`,
      middlewares: { cdn: app },
    })
  }
}

async function getCloudflareStatus(
  db: Db,
  appId: string
): Promise<CloudflareManagedCdnStatus> {
  const rows = await db
    .select({ cdn: app_cloudflare_cdn })
    .from(app_cloudflare_cdn)
    .where(eq(app_cloudflare_cdn.app_id, appId))
    .limit(1)
  const row = rows[0]?.cdn
  if (!row) {
    return {
      configured: false,
      zone_id: null,
      zone_name: null,
      hostname: null,
      origin: null,
      status: null,
      last_sync_error: null,
      synced_at: null,
      dns_record_id: null,
      ruleset_rule_id: null,
    }
  }

  return {
    configured: row.status === "configured",
    zone_id: row.zone_id,
    zone_name: row.zone_name,
    hostname: row.hostname,
    origin: row.origin,
    status: row.status,
    last_sync_error: row.last_sync_error,
    synced_at: row.synced_at?.toISOString() ?? null,
    dns_record_id: row.dns_record_id,
    ruleset_rule_id: row.ruleset_rule_id,
  }
}

async function getOrgCloudflareConnection(db: Db, orgId: string) {
  const rows = await db
    .select()
    .from(cloudflare_connections)
    .where(
      and(
        eq(cloudflare_connections.org_id, orgId),
        eq(cloudflare_connections.label, "Cloudflare")
      )
    )
    .limit(1)
  return rows[0] ?? null
}

async function upsertOrgCloudflareConnection(opts: {
  db: Db
  app: typeof apps.$inferSelect
  user: AuthUser
  apiToken?: string | undefined
}) {
  const existing = await getOrgCloudflareConnection(
    opts.db,
    opts.app.project_id
  )
  if (!opts.apiToken) return existing

  const encrypted = await encryptField(opts.apiToken)
  if (existing) {
    const [updated] = await opts.db
      .update(cloudflare_connections)
      .set({
        api_token_enc: encrypted.enc,
        api_token_nonce: encrypted.nonce,
        created_by_user_id: opts.user.id,
        updated_at: new Date(),
      })
      .where(eq(cloudflare_connections.id, existing.id))
      .returning()
    return updated ?? existing
  }

  const [created] = await opts.db
    .insert(cloudflare_connections)
    .values({
      id: nanoid(),
      org_id: opts.app.project_id,
      label: "Cloudflare",
      api_token_enc: encrypted.enc,
      api_token_nonce: encrypted.nonce,
      created_by_user_id: opts.user.id,
    })
    .returning()
  return created ?? null
}

async function getCloudflareToken(
  connection: typeof cloudflare_connections.$inferSelect
): Promise<string> {
  return decryptField(
    connection.api_token_enc as Buffer,
    connection.api_token_nonce as Buffer
  )
}

async function markCloudflareSyncing(opts: {
  db: Db
  appId: string
  connectionId: string
  input: CloudflareManagedCdn
}) {
  await opts.db
    .insert(app_cloudflare_cdn)
    .values({
      app_id: opts.appId,
      connection_id: opts.connectionId,
      zone_id: opts.input.zone_id,
      zone_name: opts.input.zone_name ?? null,
      hostname: opts.input.hostname,
      origin: opts.input.origin,
      status: "syncing",
      last_sync_error: null,
      updated_at: new Date(),
    })
    .onConflictDoUpdate({
      target: app_cloudflare_cdn.app_id,
      set: {
        connection_id: opts.connectionId,
        zone_id: opts.input.zone_id,
        zone_name: opts.input.zone_name ?? null,
        hostname: opts.input.hostname,
        origin: opts.input.origin,
        status: "syncing",
        last_sync_error: null,
        updated_at: new Date(),
      },
    })
}

async function configureCloudflareForApp(opts: {
  db: Db
  app: typeof apps.$inferSelect
  input: CloudflareManagedCdn
  connection: typeof cloudflare_connections.$inferSelect
  cloudflareFetch?: CloudflareFetch | undefined
}): Promise<CloudflareManagedCdnStatus> {
  await markCloudflareSyncing({
    db: opts.db,
    appId: opts.app.id,
    connectionId: opts.connection.id,
    input: opts.input,
  })

  const token = await getCloudflareToken(opts.connection)
  const cloudflare = new CloudflareClient(token, opts.cloudflareFetch)
  await cloudflare.verifyToken()
  const result = await cloudflare.configureManagedCdn({
    appId: opts.app.id,
    zoneId: opts.input.zone_id,
    hostname: opts.input.hostname,
    origin: opts.input.origin,
    config: {
      cache_ttl_s: opts.input.cache_ttl_s,
      cache_paths: opts.input.cache_paths,
    },
  })

  await opts.db
    .update(app_cloudflare_cdn)
    .set({
      dns_record_id: result.dnsRecordId,
      ruleset_id: result.rulesetId,
      ruleset_rule_id: result.rulesetRuleId,
      status: "configured",
      last_sync_error: null,
      synced_at: new Date(),
      updated_at: new Date(),
    })
    .where(eq(app_cloudflare_cdn.app_id, opts.app.id))

  return getCloudflareStatus(opts.db, opts.app.id)
}

export function createCdnRouter(db: Db, opts: CdnRouterOptions = {}): Hono {
  const router = new Hono()

  router.get("/:id/cdn", async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")!

    const app = await getAppForUser(db, appId, user.id)
    if (!app) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "App not found" } },
        404
      )
    }

    return c.json({ ...serializeCdnConfig(app), ready: true })
  })

  router.get("/:id/cdn/cloudflare", async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")!

    const app = await getAppForUser(db, appId, user.id)
    if (!app) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "App not found" } },
        404
      )
    }

    return c.json(await getCloudflareStatus(db, app.id))
  })

  router.put("/:id/cdn/cloudflare", async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")!

    const app = await getAppForUser(db, appId, user.id)
    if (!app) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "App not found" } },
        404
      )
    }

    let body: unknown
    try {
      body = await c.req.json()
    } catch (err) {
      return c.json(
        { error: { code: "VALIDATION_ERROR", message: String(err) } },
        400
      )
    }

    const parsed = CloudflareManagedCdnSchema.safeParse(body)
    if (!parsed.success) {
      return c.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.message,
          },
        },
        400
      )
    }
    const input = parsed.data
    const connection = await upsertOrgCloudflareConnection({
      db,
      app,
      user,
      apiToken: input.api_token,
    })
    if (!connection) {
      return c.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "api_token is required for first Cloudflare setup",
          },
        },
        400
      )
    }

    const headers =
      Object.keys(input.headers).length > 0
        ? JSON.stringify(input.headers)
        : null
    const [updatedApp] = await db
      .update(apps)
      .set({
        cdn_mode: "external",
        cdn_cache_ttl_s: input.cache_ttl_s,
        cdn_cache_paths: input.cache_paths,
        cdn_compression: false,
        cdn_image_optim: false,
        cdn_headers: headers,
        cdn_external_provider: "cloudflare",
        updated_at: new Date(),
      })
      .where(eq(apps.id, app.id))
      .returning()

    if (!updatedApp) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "App not found" } },
        404
      )
    }

    try {
      const status = await configureCloudflareForApp({
        db,
        app: updatedApp,
        input,
        connection,
        cloudflareFetch: opts.cloudflareFetch,
      })
      await syncCdnToCaddy(db, updatedApp)
      return c.json({ ...serializeCdnConfig(updatedApp), cloudflare: status })
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Cloudflare sync failed"
      await db
        .update(app_cloudflare_cdn)
        .set({
          status: "failed",
          last_sync_error: message,
          updated_at: new Date(),
        })
        .where(eq(app_cloudflare_cdn.app_id, app.id))
      return c.json(
        {
          ...serializeCdnConfig(updatedApp),
          cloudflare: await getCloudflareStatus(db, app.id),
          ready: false,
          warning: message,
        },
        202
      )
    }
  })

  router.post("/:id/cdn/cloudflare/sync", async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")!
    const app = await getAppForUser(db, appId, user.id)
    if (!app) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "App not found" } },
        404
      )
    }

    const rows = await db
      .select({ cdn: app_cloudflare_cdn, connection: cloudflare_connections })
      .from(app_cloudflare_cdn)
      .innerJoin(
        cloudflare_connections,
        eq(app_cloudflare_cdn.connection_id, cloudflare_connections.id)
      )
      .where(eq(app_cloudflare_cdn.app_id, app.id))
      .limit(1)
    const row = rows[0]
    if (!row) {
      return c.json(
        {
          error: {
            code: "NOT_FOUND",
            message: "Cloudflare CDN not configured",
          },
        },
        404
      )
    }

    try {
      const status = await configureCloudflareForApp({
        db,
        app,
        connection: row.connection,
        input: {
          zone_id: row.cdn.zone_id,
          zone_name: row.cdn.zone_name,
          hostname: row.cdn.hostname,
          origin: row.cdn.origin,
          cache_ttl_s: app.cdn_cache_ttl_s ?? 300,
          cache_paths: app.cdn_cache_paths ?? [],
          headers: parseHeaderConfig(app.cdn_headers),
        },
        cloudflareFetch: opts.cloudflareFetch,
      })
      await syncCdnToCaddy(db, app)
      return c.json({ cloudflare: status })
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Cloudflare sync failed"
      await db
        .update(app_cloudflare_cdn)
        .set({
          status: "failed",
          last_sync_error: message,
          updated_at: new Date(),
        })
        .where(eq(app_cloudflare_cdn.app_id, app.id))
      return c.json(
        {
          cloudflare: await getCloudflareStatus(db, app.id),
          warning: message,
        },
        202
      )
    }
  })

  router.post("/:id/cdn/cloudflare/purge", async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")!
    const app = await getAppForUser(db, appId, user.id)
    if (!app) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "App not found" } },
        404
      )
    }

    const rows = await db
      .select({ cdn: app_cloudflare_cdn, connection: cloudflare_connections })
      .from(app_cloudflare_cdn)
      .innerJoin(
        cloudflare_connections,
        eq(app_cloudflare_cdn.connection_id, cloudflare_connections.id)
      )
      .where(eq(app_cloudflare_cdn.app_id, app.id))
      .limit(1)
    const row = rows[0]
    if (!row) {
      return c.json(
        {
          error: {
            code: "NOT_FOUND",
            message: "Cloudflare CDN not configured",
          },
        },
        404
      )
    }

    const token = await getCloudflareToken(row.connection)
    const cloudflare = new CloudflareClient(token, opts.cloudflareFetch)
    await cloudflare.purgeHostname(row.cdn.zone_id, row.cdn.hostname)
    return c.json({ ok: true })
  })

  router.put("/:id/cdn", async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")!

    const app = await getAppForUser(db, appId, user.id)
    if (!app) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "App not found" } },
        404
      )
    }

    let body: unknown
    try {
      body = await c.req.json()
    } catch (err) {
      return c.json(
        { error: { code: "VALIDATION_ERROR", message: String(err) } },
        400
      )
    }

    const parsed = CdnConfigSchema.safeParse(body)
    if (!parsed.success) {
      return c.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.message,
          },
        },
        400
      )
    }

    const config = parsed.data
    if (config.mode === "external" && !config.external_provider) {
      return c.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "external_provider is required when CDN mode is external",
          },
        },
        400
      )
    }

    const [updated] = await db
      .update(apps)
      .set({
        cdn_mode: config.mode,
        cdn_cache_ttl_s: config.cache_ttl_s,
        cdn_cache_paths: config.cache_paths,
        cdn_compression: config.compression,
        cdn_image_optim: config.image_optim,
        cdn_headers:
          Object.keys(config.headers).length > 0
            ? JSON.stringify(config.headers)
            : null,
        cdn_external_provider:
          config.mode === "external" ? config.external_provider : null,
        updated_at: new Date(),
      })
      .where(eq(apps.id, appId))
      .returning()

    if (!updated) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "App not found" } },
        404
      )
    }

    try {
      await syncCdnToCaddy(db, updated)
    } catch (err) {
      return c.json(
        {
          ...serializeCdnConfig(updated),
          ready: false,
          warning: err instanceof Error ? err.message : "Caddy sync failed",
        },
        202
      )
    }

    return c.json({ ...serializeCdnConfig(updated), ready: true })
  })

  return router
}
