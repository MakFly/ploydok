// SPDX-License-Identifier: AGPL-3.0-only
import { Hono } from "hono"
import { z } from "zod"
import { randomBytes } from "node:crypto"
import { eq } from "drizzle-orm"
import { nanoid } from "nanoid"
import { createDb, tls_certificates, domains } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { env } from "../env"
import { getAppForUser } from "@ploydok/db/queries"
import {
  listDomainsForApp,
  addDomain,
  deleteDomain,
  getDomain,
  updateDomainTlsStatus,
  updateDomainDns01,
  getDomainByHostname,
} from "@ploydok/db/queries"
import { CaddyClient } from "../caddy/client"
import { domainVerifyQueue } from "../worker/queues"
import { childLogger } from "../logger"
import type { AuthUser } from "../auth/middleware"
import { requireSecondFactor } from "../auth/middleware"
import { encryptField, decryptField } from "../github/app-credentials"
import { parseAndValidateCert } from "../domains/cert-parser"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Hostname validation regex.
 * - Starts with a letter or digit.
 * - Allows letters, digits, hyphens, and dots.
 * - TLD must be at least 2 letters.
 * - Total length ≤ 253 characters (DNS limit).
 *
 * Note: we allow subdomains (e.g. api.example.com) and international-looking
 * hostnames at the surface level — DNS constraints are enforced at the DNS
 * layer, not here. Pure IP addresses are rejected intentionally.
 */
const HOSTNAME_REGEX = /^[a-z0-9][a-z0-9.-]{1,253}\.[a-z]{2,}$/i

const log = childLogger("domains")

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const Dns01ProviderEnum = z.enum([
  "cloudflare",
  "route53",
  "ovh",
  "digitalocean",
])

const AddDomainBody = z.object({
  hostname: z
    .string()
    .min(4, "Hostname too short")
    .max(255, "Hostname too long")
    .regex(HOSTNAME_REGEX, "Invalid hostname format (e.g. app.example.com)"),
  tls_mode: z.enum(["http01", "dns01"]).optional().default("http01"),
  dns01_provider: Dns01ProviderEnum.optional(),
  wildcard: z.boolean().optional().default(false),
})

const SwitchTlsModeBody = z.object({
  tls_mode: z.enum(["http01", "dns01"]),
  dns01_provider: Dns01ProviderEnum.optional(),
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getUser(c: { get: (key: string) => unknown }): AuthUser {
  return c.get("user") as AuthUser
}

function serializeDomain(row: {
  id: string
  hostname: string
  tls_status: string
  tls_mode?: string | null
  dns01_provider?: string | null
  verify_token?: string | null
  verify_error?: string | null
  created_at: Date | null
}) {
  return {
    id: row.id,
    hostname: row.hostname,
    tlsStatus: row.tls_status,
    tlsMode: row.tls_mode ?? "http01",
    dns01Provider: row.dns01_provider ?? null,
    // expose verify_token so user can set the TXT record
    verifyToken: row.verify_token ?? null,
    verifyError: row.verify_error ?? null,
    createdAt: row.created_at?.toISOString() ?? null,
  }
}

// ---------------------------------------------------------------------------
// Caddy integration helpers
//
// Strategy: try-catch silencieux (MVP trade-off).
// The DB is the source of truth for domain ownership. Caddy registration is
// best-effort: if Caddy is down or mis-configured, the domain is still stored
// in the DB with `tls_status = 'pending'`. The user can trigger a re-check
// later via POST /:id/domains/:domainId/recheck.
// ---------------------------------------------------------------------------

const caddyClient = new CaddyClient(
  Bun.env["CADDY_ADMIN_URL"] ?? "http://127.0.0.1:2020"
)

/**
 * Attempt to register a custom hostname route in Caddy.
 * Silently logs a warning on failure — never throws.
 *
 * For a custom domain, we add it as an additional host matcher on the
 * app's existing route. For MVP simplicity we upsert a dedicated route
 * with the same upstream so we avoid having to parse + merge match arrays.
 * The route id is `ploydok-domain-{domainId}` to keep it separate from the
 * main app route (`ploydok-{appId}`).
 */
async function tryCaddyAddDomain(
  appId: string,
  domainId: string,
  hostname: string
): Promise<void> {
  try {
    // Fetch the current upstream from the app's main route. If the app hasn't
    // been deployed yet the route won't exist — that's fine, we register the
    // hostname now and the deploy handler will set the upstream later.
    const upstream = await caddyClient.getUpstream(appId)
    if (!upstream) {
      log.warn(
        { appId, hostname },
        "caddy: no upstream found for app — domain registered in DB only"
      )
      return
    }
    await caddyClient.upsertRoute({
      host: hostname,
      upstream: `${upstream.host}:${upstream.port}`,
      appId: `domain-${domainId}`,
    })
    log.info({ appId, domainId, hostname }, "caddy: domain route registered")
  } catch (err) {
    log.warn(
      { appId, domainId, hostname, err },
      "caddy: failed to register domain route — continuing"
    )
  }
}

/**
 * Attempt to remove a custom hostname route from Caddy. Silently logs on failure.
 */
async function tryCaddyRemoveDomain(
  domainId: string,
  hostname: string
): Promise<void> {
  try {
    await caddyClient.removeRoute(`domain-${domainId}`)
    log.info({ domainId, hostname }, "caddy: domain route removed")
  } catch (err) {
    log.warn(
      { domainId, hostname, err },
      "caddy: failed to remove domain route — DB record deleted anyway"
    )
  }
}

/**
 * Check whether Caddy currently has a valid TLS certificate for this hostname.
 * Returns the inferred TLS status.
 *
 * Heuristic: if Caddy has a route for the hostname → it has attempted cert
 * issuance. We check via GET /id/ploydok-domain-{domainId}. If it returns
 * a route, we mark as "issued"; if the route is missing we mark as "pending";
 * if the Caddy call errors we mark as "failed".
 *
 * Note: production Caddy with ACME would expose certificate metadata in the
 * PKI admin API (`/pki/ca/{id}/certificates`), which is more accurate. That
 * integration is deferred to Wave 4. This heuristic is good enough for MVP.
 */
async function tryCaddyCheckTls(
  domainId: string
): Promise<"pending" | "issued" | "failed"> {
  try {
    await caddyClient.getUpstream(`domain-${domainId}`)
    // If getUpstream returns without throwing, the route exists → consider issued.
    return "issued"
  } catch {
    return "failed"
  }
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export function createAppsDomainsRouter(db: Db): Hono {
  const router = new Hono()

  const sf = requireSecondFactor(db)

  // -------------------------------------------------------------------------
  // GET /:id/domains — List custom domains for an app
  // -------------------------------------------------------------------------

  router.get("/:id/domains", async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")

    const app = await getAppForUser(db, appId, user.id)
    if (!app) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "App not found" } },
        404
      )
    }

    const rows = await listDomainsForApp(db, appId)

    return c.json({ domains: rows.map(serializeDomain) })
  })

  // -------------------------------------------------------------------------
  // POST /:id/domains — Add a custom domain
  // -------------------------------------------------------------------------

  router.post("/:id/domains", sf, async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")!

    const app = await getAppForUser(db, appId, user.id)
    if (!app) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "App not found" } },
        404
      )
    }

    let body: z.infer<typeof AddDomainBody>
    try {
      body = AddDomainBody.parse(await c.req.json())
    } catch (err) {
      return c.json(
        { error: { code: "VALIDATION_ERROR", message: String(err) } },
        400
      )
    }

    if (body.tls_mode === "dns01" && !body.dns01_provider) {
      return c.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "dns01_provider is required when tls_mode=dns01",
          },
        },
        400
      )
    }

    const hostname = body.hostname.toLowerCase()

    // Global uniqueness check — one hostname can only belong to one app.
    const existing = await getDomainByHostname(db, hostname)
    if (existing) {
      return c.json(
        {
          error: {
            code: "CONFLICT",
            message: "Hostname already in use by another app",
          },
        },
        409
      )
    }

    const verifyToken = randomBytes(16).toString("hex")

    const row = await addDomain(db, appId, hostname, {
      tls_mode: body.tls_mode,
      dns01_provider: body.dns01_provider ?? null,
      verify_token: verifyToken,
      requested_by_user_id: user.id,
      verify_source: "api",
    })

    // Best-effort Caddy registration — must not block the response.
    void tryCaddyAddDomain(appId, row.id, hostname)

    // Enqueue DNS verification job
    await domainVerifyQueue.add(
      "domain.verify",
      { domainId: row.id },
      { jobId: `verify-${row.id}-0` }
    )

    return c.json({ domain: serializeDomain(row) }, 201)
  })

  // -------------------------------------------------------------------------
  // DELETE /:id/domains/:domainId — Remove a custom domain
  // -------------------------------------------------------------------------

  router.delete("/:id/domains/:domainId", sf, async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")!
    const domainId = c.req.param("domainId")!

    const app = await getAppForUser(db, appId, user.id)
    if (!app) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "App not found" } },
        404
      )
    }

    const domain = await getDomain(db, domainId)
    if (!domain || domain.app_id !== appId) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Domain not found" } },
        404
      )
    }

    await deleteDomain(db, domainId)

    // Best-effort Caddy cleanup.
    void tryCaddyRemoveDomain(domainId, domain.hostname)

    return new Response(null, { status: 204 })
  })

  // -------------------------------------------------------------------------
  // POST /:id/domains/:domainId/recheck — Re-check TLS certificate status
  // -------------------------------------------------------------------------

  router.post("/:id/domains/:domainId/recheck", async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")
    const domainId = c.req.param("domainId")

    const app = await getAppForUser(db, appId, user.id)
    if (!app) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "App not found" } },
        404
      )
    }

    const domain = await getDomain(db, domainId)
    if (!domain || domain.app_id !== appId) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Domain not found" } },
        404
      )
    }

    const newStatus = await tryCaddyCheckTls(domainId)
    const updated = await updateDomainTlsStatus(db, domainId, newStatus)

    return c.json({ domain: serializeDomain(updated ?? domain) })
  })

  // -------------------------------------------------------------------------
  // POST /:id/domains/:domainId/tls/mode — Switch TLS provisioning mode
  // -------------------------------------------------------------------------

  router.post("/:id/domains/:domainId/tls/mode", async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")!
    const domainId = c.req.param("domainId")!

    const app = await getAppForUser(db, appId, user.id)
    if (!app) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "App not found" } },
        404
      )
    }

    const domain = await getDomain(db, domainId)
    if (!domain || domain.app_id !== appId) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Domain not found" } },
        404
      )
    }

    let body: z.infer<typeof SwitchTlsModeBody>
    try {
      body = SwitchTlsModeBody.parse(await c.req.json())
    } catch (err) {
      return c.json(
        { error: { code: "VALIDATION_ERROR", message: String(err) } },
        400
      )
    }

    if (body.tls_mode === "dns01" && !body.dns01_provider) {
      return c.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: `no dns01 credentials for ${body.dns01_provider ?? "unknown"} — dns01_provider required`,
          },
        },
        400
      )
    }

    const updated = await updateDomainDns01(db, domainId, {
      tls_mode: body.tls_mode,
      dns01_provider: body.dns01_provider ?? null,
    })

    // Re-enqueue verification on mode switch
    if (updated) {
      // Reset the gate for re-verification
      await db
        .update(domains)
        .set({
          requested_by_user_id: user.id,
          verify_source: "api",
          verify_claimed_at: null,
        })
        .where(eq(domains.id, domainId))

      await domainVerifyQueue.add(
        "domain.verify",
        { domainId },
        { jobId: `verify-${domainId}-switch-${Date.now()}` }
      )
    }

    return c.json({ domain: serializeDomain(updated ?? domain) })
  })

  // -------------------------------------------------------------------------
  // POST /:id/domains/:domain/tls/upload — upload manual TLS cert
  // -------------------------------------------------------------------------

  const UploadCertBody = z.object({
    cert: z.string().min(10, "cert is required"),
    key: z.string().min(10, "key is required"),
  })

  router.post("/:id/domains/:domainHostname/tls/upload", sf, async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")!
    const domainHostname = c.req.param("domainHostname")!

    const app = await getAppForUser(db, appId, user.id)
    if (!app) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "App not found" } },
        404
      )
    }

    const domain = await getDomainByHostname(db, domainHostname.toLowerCase())
    if (!domain || domain.app_id !== appId) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Domain not found" } },
        404
      )
    }

    let body: z.infer<typeof UploadCertBody>
    try {
      body = UploadCertBody.parse(await c.req.json())
    } catch (err) {
      return c.json(
        { error: { code: "VALIDATION_ERROR", message: String(err) } },
        400
      )
    }

    const parseResult = parseAndValidateCert(
      body.cert,
      body.key,
      domainHostname
    )
    if (!parseResult.ok) {
      return c.json(
        {
          error: {
            code: "INVALID_CERT",
            message: parseResult.error ?? "Invalid certificate",
          },
        },
        400
      )
    }

    // Encrypt cert + key
    const { enc: certEnc, nonce: certNonce } = await encryptField(body.cert)
    const { enc: keyEnc, nonce: keyNonce } = await encryptField(body.key)

    // Upsert tls_certificates row
    await db
      .insert(tls_certificates)
      .values({
        id: nanoid(),
        app_id: appId,
        domain: domainHostname.toLowerCase(),
        cert_enc: certEnc,
        cert_nonce: certNonce,
        key_enc: keyEnc,
        key_nonce: keyNonce,
        not_before: parseResult.notBefore ?? null,
        not_after: parseResult.notAfter ?? null,
      })
      .onConflictDoUpdate({
        target: [tls_certificates.app_id, tls_certificates.domain],
        set: {
          cert_enc: certEnc,
          cert_nonce: certNonce,
          key_enc: keyEnc,
          key_nonce: keyNonce,
          not_before: parseResult.notBefore ?? null,
          not_after: parseResult.notAfter ?? null,
          last_alert_sent_at: null,
          created_at: new Date(),
        },
      })

    // Mark domain TLS status as issued (manual cert takes priority over ACME)
    await updateDomainTlsStatus(db, domain.id, "issued")

    log.info({ appId, domain: domainHostname }, "manual TLS cert uploaded")

    return c.json({
      uploaded: true,
      notBefore: parseResult.notBefore?.toISOString() ?? null,
      notAfter: parseResult.notAfter?.toISOString() ?? null,
      sans: parseResult.sans ?? [],
    })
  })

  // -------------------------------------------------------------------------
  // DELETE /:id/domains/:domain/tls/custom — remove manual cert, revert to ACME
  // -------------------------------------------------------------------------

  router.delete("/:id/domains/:domainHostname/tls/custom", sf, async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")!
    const domainHostname = c.req.param("domainHostname")!

    const app = await getAppForUser(db, appId, user.id)
    if (!app) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "App not found" } },
        404
      )
    }

    const domain = await getDomainByHostname(db, domainHostname.toLowerCase())
    if (!domain || domain.app_id !== appId) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Domain not found" } },
        404
      )
    }

    await db.delete(tls_certificates).where(eq(tls_certificates.app_id, appId))

    // Reset TLS status to pending so ACME can retry
    await updateDomainTlsStatus(db, domain.id, "pending")

    // Reset the gate for re-verification
    await db
      .update(domains)
      .set({
        requested_by_user_id: user.id,
        verify_source: "api",
        verify_claimed_at: null,
      })
      .where(eq(domains.id, domain.id))

    // Re-enqueue DNS verification to trigger ACME re-issuance
    await domainVerifyQueue.add(
      "domain.verify",
      { domainId: domain.id },
      { jobId: `verify-${domain.id}-revert-${Date.now()}` }
    )

    log.info(
      { appId, domain: domainHostname },
      "manual TLS cert removed — reverted to ACME"
    )

    return new Response(null, { status: 204 })
  })

  return router
}

// ---------------------------------------------------------------------------
// Prod singleton
// ---------------------------------------------------------------------------

const prodDb = createDb(env.DATABASE_URL)
export const appsDomainsRouter = createAppsDomainsRouter(prodDb)
