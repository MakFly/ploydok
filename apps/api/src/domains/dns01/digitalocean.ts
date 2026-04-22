// SPDX-License-Identifier: AGPL-3.0-only
import type { Dns01Provider, TxtRecord, DigitalOceanCredentials, FetchFn } from "./types.js"

const DO_API = "https://api.digitalocean.com/v2"

interface DoDomainRecord {
  domain_record: { id: number }
}

export function createDigitalOceanProvider(
  creds: DigitalOceanCredentials,
  fetchFn: FetchFn = fetch,
): Dns01Provider {
  const headers = {
    Authorization: `Bearer ${creds.token}`,
    "Content-Type": "application/json",
  }

  return {
    name: "digitalocean",

    async createTXTRecord(zone, name, value): Promise<TxtRecord> {
      // DigitalOcean expects subdomain relative to zone
      const subdomain = name.replace(new RegExp(`\\.?${zone.replace(/\.$/, "")}$`), "")
      const res = await fetchFn(`${DO_API}/domains/${zone}/records`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          type: "TXT",
          name: subdomain || "@",
          data: value,
          ttl: 10,
        }),
      })
      if (!res.ok) {
        throw new Error(`digitalocean.createTXTRecord failed (${res.status}): ${await res.text()}`)
      }
      const body = (await res.json()) as DoDomainRecord
      return { recordId: String(body.domain_record.id) }
    },

    async deleteTXTRecord(zone, recordId): Promise<void> {
      const res = await fetchFn(`${DO_API}/domains/${zone}/records/${recordId}`, {
        method: "DELETE",
        headers,
      })
      if (!res.ok && res.status !== 404) {
        throw new Error(`digitalocean.deleteTXTRecord failed (${res.status}): ${await res.text()}`)
      }
    },
  }
}
