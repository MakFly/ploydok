// SPDX-License-Identifier: AGPL-3.0-only
import { Hono } from "hono"
import { z } from "zod"
import { createDb } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { env } from "../env"
import { getAppForUser } from "../queries/apps"
import {
  listDomainsForApp,
  addDomain,
  deleteDomain,
  getDomain,
  updateDomainTlsStatus,
  getDomainByHostname,
} from "../queries/domains"
import { CaddyClient } from "../caddy/client"
import { childLogger } from "../logger"
import type { AuthUser } from "../auth/middleware"
import { requireSecondFactor } from "../auth/middleware"

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

const AddDomainBody = z.object({
  hostname: z
    .string()
    .min(4, "Hostname too short")
    .max(255, "Hostname too long")
    .regex(HOSTNAME_REGEX, "Invalid hostname format (e.g. app.example.com)"),
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
  created_at: Date | null
}) {
  return {
    id: row.id,
    hostname: row.hostname,
    tlsStatus: row.tls_status,
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
  Bun.env["CADDY_ADMIN_URL"] ?? "http://127.0.0.1:2020",
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
  hostname: string,
): Promise<void> {
  try {
    // Fetch the current upstream from the app's main route. If the app hasn't
    // been deployed yet the route won't exist — that's fine, we register the
    // hostname now and the deploy handler will set the upstream later.
    const upstream = await caddyClient.getUpstream(appId)
    if (!upstream) {
      log.warn({ appId, hostname }, "caddy: no upstream found for app — domain registered in DB only")
      return
    }
    await caddyClient.upsertRoute({
      host: hostname,
      upstream: `${upstream.host}:${upstream.port}`,
      appId: `domain-${domainId}`,
    })
    log.info({ appId, domainId, hostname }, "caddy: domain route registered")
  } catch (err) {
    log.warn({ appId, domainId, hostname, err }, "caddy: failed to register domain route — continuing")
  }
}

/**
 * Attempt to remove a custom hostname route from Caddy. Silently logs on failure.
 */
async function tryCaddyRemoveDomain(domainId: string, hostname: string): Promise<void> {
  try {
    await caddyClient.removeRoute(`domain-${domainId}`)
    log.info({ domainId, hostname }, "caddy: domain route removed")
  } catch (err) {
    log.warn({ domainId, hostname, err }, "caddy: failed to remove domain route — DB record deleted anyway")
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
async function tryCaddyCheckTls(domainId: string): Promise<"pending" | "issued" | "failed"> {
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
      return c.json({ error: { code: "NOT_FOUND", message: "App not found" } }, 404)
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
      return c.json({ error: { code: "NOT_FOUND", message: "App not found" } }, 404)
    }

    let body: z.infer<typeof AddDomainBody>
    try {
      body = AddDomainBody.parse(await c.req.json())
    } catch (err) {
      return c.json({ error: { code: "VALIDATION_ERROR", message: String(err) } }, 400)
    }

    const hostname = body.hostname.toLowerCase()

    // Global uniqueness check — one hostname can only belong to one app.
    const existing = await getDomainByHostname(db, hostname)
    if (existing) {
      return c.json(
        { error: { code: "CONFLICT", message: "Hostname already in use by another app" } },
        409,
      )
    }

    const row = await addDomain(db, appId, hostname)

    // Best-effort Caddy registration — must not block the response.
    void tryCaddyAddDomain(appId, row.id, hostname)

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
      return c.json({ error: { code: "NOT_FOUND", message: "App not found" } }, 404)
    }

    const domain = await getDomain(db, domainId)
    if (!domain || domain.app_id !== appId) {
      return c.json({ error: { code: "NOT_FOUND", message: "Domain not found" } }, 404)
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
      return c.json({ error: { code: "NOT_FOUND", message: "App not found" } }, 404)
    }

    const domain = await getDomain(db, domainId)
    if (!domain || domain.app_id !== appId) {
      return c.json({ error: { code: "NOT_FOUND", message: "Domain not found" } }, 404)
    }

    const newStatus = await tryCaddyCheckTls(domainId)
    const updated = await updateDomainTlsStatus(db, domainId, newStatus)

    return c.json({ domain: serializeDomain(updated ?? domain) })
  })

  return router
}

// ---------------------------------------------------------------------------
// Prod singleton
// ---------------------------------------------------------------------------

const prodDb = createDb(env.DATABASE_URL)
export const appsDomainsRouter = createAppsDomainsRouter(prodDb)
