// SPDX-License-Identifier: AGPL-3.0-only
import { eq } from "drizzle-orm"
import {
  app_cloudflare_cdn,
  cloudflare_connections,
  type Db,
} from "@ploydok/db"
import { decryptField } from "../github/app-credentials"
import { childLogger } from "../logger"
import { CloudflareClient, type CloudflareFetch } from "./client"

const log = childLogger("cloudflare")

export async function purgeCloudflareForApp(
  db: Db,
  appId: string,
  opts: { fetchFn?: CloudflareFetch } = {}
): Promise<boolean> {
  try {
    const rows = await db
      .select({ cdn: app_cloudflare_cdn, connection: cloudflare_connections })
      .from(app_cloudflare_cdn)
      .innerJoin(
        cloudflare_connections,
        eq(app_cloudflare_cdn.connection_id, cloudflare_connections.id)
      )
      .where(eq(app_cloudflare_cdn.app_id, appId))
      .limit(1)
    const row = rows[0]
    if (!row || row.cdn.status !== "configured") return false

    const token = await decryptField(
      row.connection.api_token_enc as Buffer,
      row.connection.api_token_nonce as Buffer
    )
    const cloudflare = new CloudflareClient(token, opts.fetchFn)
    await cloudflare.purgeHostname(row.cdn.zone_id, row.cdn.hostname)
    return true
  } catch (err) {
    log.warn({ err, appId }, "cloudflare purge failed")
    return false
  }
}
