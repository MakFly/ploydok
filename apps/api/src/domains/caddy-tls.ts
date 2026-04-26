// SPDX-License-Identifier: AGPL-3.0-only
import { and, eq, or } from "drizzle-orm"
import { secrets } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import type { CaddyTlsOptions } from "../caddy/types"
import { decryptSecret } from "../secrets/crypto"

export const CLOUDFLARE_API_TOKEN_KEY = "CLOUDFLARE_API_TOKEN"
export const CLOUDFLARE_ZONE_ID_KEY = "CLOUDFLARE_ZONE_ID"

export type Dns01Provider =
  | "cloudflare"
  | "route53"
  | "ovh"
  | "digitalocean"

async function getCloudflareDns01Config(db: Db, appId: string): Promise<Record<string, string> | null> {
  const rows = await db
    .select({
      key: secrets.key,
      value: secrets.value_ciphertext,
      nonce: secrets.nonce,
    })
    .from(secrets)
    .where(
      and(
        eq(secrets.app_id, appId),
        eq(secrets.scope, "shared"),
        or(eq(secrets.phase, "runtime"), eq(secrets.phase, "both")),
        or(
          eq(secrets.key, CLOUDFLARE_API_TOKEN_KEY),
          eq(secrets.key, CLOUDFLARE_ZONE_ID_KEY),
        ),
      ),
    )

  if (rows.length !== 2) {
    return null
  }

  try {
    const map = new Map<string, string>()
    await Promise.all(
      rows.map(async (row) => {
        const value = await decryptSecret(row.value as Buffer, row.nonce as Buffer)
        map.set(row.key, value)
      }),
    )

    const apiToken = map.get(CLOUDFLARE_API_TOKEN_KEY)
    const zoneId = map.get(CLOUDFLARE_ZONE_ID_KEY)
    if (!apiToken || !zoneId) return null

    return {
      api_token: apiToken,
      zone_id: zoneId,
    }
  } catch {
    return null
  }
}

export async function getCaddyTlsOptionsForDomain(
  db: Db,
  appId: string,
  tlsMode: "http01" | "dns01",
  dns01Provider: Dns01Provider | string | null | undefined,
): Promise<CaddyTlsOptions | null> {
  if (tlsMode === "http01") {
    return { mode: "http01" }
  }

  if (dns01Provider !== "cloudflare") {
    return null
  }

  const providerConfig = await getCloudflareDns01Config(db, appId)
  if (!providerConfig) return null

  return {
    mode: "dns01",
    provider: "cloudflare",
    providerConfig,
  }
}
