// SPDX-License-Identifier: AGPL-3.0-only
import { eq } from "drizzle-orm"
import { domains } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { verifyDomain } from "../../domains/verifier.js"
import { CaddyClient } from "../../caddy/client.js"
import { workerLog as logger } from "../logger.js"

export interface DomainVerifyPayload {
  domainId: string
  appId: string
}

const caddyClient = new CaddyClient(
  Bun.env["CADDY_ADMIN_URL"] ?? "http://127.0.0.1:2020",
)

export async function handleDomainVerify(db: Db, payload: DomainVerifyPayload): Promise<void> {
  const { domainId, appId } = payload

  logger.info({ domainId }, "domain.verify job started")

  const result = await verifyDomain(db, domainId)

  if (!result.ok) {
    logger.warn({ domainId, reason: result.reason }, "domain verification failed — will retry")
    await db
      .update(domains)
      .set({ verify_error: result.reason ?? null, updated_at: new Date() })
      .where(eq(domains.id, domainId))
    // Throw so BullMQ retries with backoff
    throw new Error(`domain verification failed: ${result.reason}`)
  }

  // Verification passed — mark issued and register Caddy route
  await db
    .update(domains)
    .set({ tls_status: "issued", verify_error: null, updated_at: new Date() })
    .where(eq(domains.id, domainId))

  logger.info({ domainId, appId }, "domain verified — registering Caddy route")

  try {
    const upstream = await caddyClient.getUpstream(appId)
    if (upstream) {
      const rows = await db.select().from(domains).where(eq(domains.id, domainId)).limit(1)
      const domain = rows[0]
      if (domain) {
        await caddyClient.upsertRoute({
          host: domain.hostname,
          upstream: `${upstream.host}:${upstream.port}`,
          appId: `domain-${domainId}`,
        })
        logger.info({ domainId, hostname: domain.hostname }, "Caddy domain route registered")
      }
    }
  } catch (err) {
    // Non-fatal: domain is verified in DB, Caddy registration is best-effort
    logger.warn({ domainId, err }, "Caddy registration failed after domain verify — continuing")
  }
}
