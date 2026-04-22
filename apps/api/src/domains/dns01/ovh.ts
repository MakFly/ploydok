// SPDX-License-Identifier: AGPL-3.0-only
// OVH DNS-01 provider via OVH REST API v1.
// Docs: https://api.ovh.com/1.0/
import { createHash, createHmac } from "node:crypto"
import type { Dns01Provider, TxtRecord, OvhCredentials, FetchFn } from "./types.js"

const ENDPOINTS: Record<string, string> = {
  "ovh-eu": "https://eu.api.ovh.com/1.0",
  "ovh-ca": "https://ca.api.ovh.com/1.0",
  "ovh-us": "https://us.api.ovh.com/1.0",
}

function sha1hex(data: string): string {
  return createHash("sha1").update(data).digest("hex")
}

function ovhSign(
  appSecret: string,
  consumerKey: string,
  method: string,
  url: string,
  body: string,
  timestamp: number,
): string {
  const signature = `${appSecret}+${consumerKey}+${method}+${url}+${body}+${timestamp}`
  return "$1$" + sha1hex(signature)
}

interface OvhDnsRecord {
  id: number
}

export function createOvhProvider(
  creds: OvhCredentials,
  fetchFn: FetchFn = fetch,
): Dns01Provider {
  const baseUrl = ENDPOINTS[creds.endpoint ?? "ovh-eu"] ?? ENDPOINTS["ovh-eu"]!

  async function ovhFetch(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const timestamp = Math.floor(Date.now() / 1000)
    const url = `${baseUrl}${path}`
    const bodyStr = body !== undefined ? JSON.stringify(body) : ""
    const sig = ovhSign(
      creds.application_secret,
      creds.consumer_key,
      method,
      url,
      bodyStr,
      timestamp,
    )

    return fetchFn(url, {
      method,
      headers: {
        "X-Ovh-Application": creds.application_key,
        "X-Ovh-Consumer": creds.consumer_key,
        "X-Ovh-Timestamp": String(timestamp),
        "X-Ovh-Signature": sig,
        "Content-Type": "application/json",
      },
      body: body !== undefined ? bodyStr : undefined,
    })
  }

  return {
    name: "ovh",

    async createTXTRecord(zone, name, value): Promise<TxtRecord> {
      // Subdomain relative to zone (strip trailing zone dot)
      const subdomain = name.replace(new RegExp(`\\.?${zone.replace(/\.$/, "")}$`), "")
      const res = await ovhFetch("POST", `/domain/zone/${zone}/record`, {
        fieldType: "TXT",
        subDomain: subdomain,
        target: `"${value}"`,
        ttl: 10,
      })
      if (!res.ok) {
        throw new Error(`ovh.createTXTRecord failed (${res.status}): ${await res.text()}`)
      }
      const rec = (await res.json()) as OvhDnsRecord
      // Refresh zone
      await ovhFetch("POST", `/domain/zone/${zone}/refresh`)
      return { recordId: String(rec.id) }
    },

    async deleteTXTRecord(zone, recordId): Promise<void> {
      const res = await ovhFetch("DELETE", `/domain/zone/${zone}/record/${recordId}`)
      if (!res.ok && res.status !== 404) {
        throw new Error(`ovh.deleteTXTRecord failed (${res.status}): ${await res.text()}`)
      }
      await ovhFetch("POST", `/domain/zone/${zone}/refresh`)
    },
  }
}
