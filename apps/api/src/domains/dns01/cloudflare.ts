// SPDX-License-Identifier: AGPL-3.0-only
import type { Dns01Provider, TxtRecord, CloudflareCredentials, FetchFn } from "./types.js"

const CF_API = "https://api.cloudflare.com/client/v4"

interface CfResult<T> {
  success: boolean
  errors: Array<{ message: string }>
  result: T
}

interface CfDnsRecord {
  id: string
}

function authHeaders(creds: CloudflareCredentials): Record<string, string> {
  if (creds.api_token) {
    return { Authorization: `Bearer ${creds.api_token}` }
  }
  if (creds.api_key && creds.email) {
    return { "X-Auth-Key": creds.api_key, "X-Auth-Email": creds.email }
  }
  throw new Error("cloudflare: must provide api_token or api_key+email")
}

export function createCloudflareProvider(
  creds: CloudflareCredentials,
  fetchFn: FetchFn = fetch,
): Dns01Provider {
  const headers = { ...authHeaders(creds), "Content-Type": "application/json" }

  return {
    name: "cloudflare",

    async createTXTRecord(_zone, name, value): Promise<TxtRecord> {
      const res = await fetchFn(`${CF_API}/zones/${creds.zone_id}/dns_records`, {
        method: "POST",
        headers,
        body: JSON.stringify({ type: "TXT", name, content: value, ttl: 10 }),
      })
      const body = (await res.json()) as CfResult<CfDnsRecord>
      if (!res.ok || !body.success) {
        const msg = body.errors?.[0]?.message ?? res.statusText
        throw new Error(`cloudflare.createTXTRecord failed (${res.status}): ${msg}`)
      }
      return { recordId: body.result.id }
    },

    async deleteTXTRecord(_zone, recordId): Promise<void> {
      const res = await fetchFn(
        `${CF_API}/zones/${creds.zone_id}/dns_records/${recordId}`,
        { method: "DELETE", headers },
      )
      if (!res.ok) {
        throw new Error(`cloudflare.deleteTXTRecord failed (${res.status}): ${res.statusText}`)
      }
    },
  }
}
