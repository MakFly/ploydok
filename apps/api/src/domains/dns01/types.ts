// SPDX-License-Identifier: AGPL-3.0-only

export interface TxtRecord {
  recordId: string
}

export interface Dns01Provider {
  name: string
  createTXTRecord(zone: string, name: string, value: string): Promise<TxtRecord>
  deleteTXTRecord(zone: string, recordId: string): Promise<void>
}

export type Dns01ProviderName = "cloudflare" | "route53" | "ovh" | "digitalocean"

export interface Dns01Credentials {
  provider: Dns01ProviderName
  [k: string]: string
}

// Minimal fetch type alias — avoids Bun-specific `fetch.preconnect` signature mismatch in tests
export type FetchFn = (url: string | URL | Request, init?: RequestInit) => Promise<Response>

// Credentials shapes per provider
export interface CloudflareCredentials {
  provider: "cloudflare"
  // Either api_token (preferred) or api_key + email
  api_token?: string
  api_key?: string
  email?: string
  zone_id: string
}

export interface Route53Credentials {
  provider: "route53"
  access_key_id: string
  secret_access_key: string
  region?: string
}

export interface OvhCredentials {
  provider: "ovh"
  application_key: string
  application_secret: string
  consumer_key: string
  endpoint?: string // default: ovh-eu
}

export interface DigitalOceanCredentials {
  provider: "digitalocean"
  token: string
}
