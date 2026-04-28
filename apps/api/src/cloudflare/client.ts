// SPDX-License-Identifier: AGPL-3.0-only
import type { CdnConfig } from "@ploydok/shared"

const CF_API = "https://api.cloudflare.com/client/v4"

export type CloudflareFetch = (
  url: string | URL | Request,
  init?: RequestInit
) => Promise<Response>

interface CfEnvelope<T> {
  success: boolean
  errors?: Array<{ message?: string }>
  result: T
}

interface CfZone {
  id: string
  name: string
  account?: { id?: string; name?: string }
}

interface CfDnsRecord {
  id: string
  type: string
  name: string
  content: string
  proxied?: boolean
}

interface CfRulesetRule {
  id?: string
  ref?: string
  description?: string
  expression: string
  action: string
  action_parameters?: Record<string, unknown>
  enabled?: boolean
}

interface CfRuleset {
  id: string
  rules?: Array<CfRulesetRule>
}

export interface CloudflareZone {
  id: string
  name: string
  accountId: string | null
}

export interface UpsertCloudflareCdnInput {
  appId: string
  zoneId: string
  hostname: string
  origin: string
  config: Pick<CdnConfig, "cache_ttl_s" | "cache_paths">
}

export interface UpsertCloudflareCdnResult {
  dnsRecordId: string
  rulesetId: string | null
  rulesetRuleId: string | null
}

function cfError(status: number, fallback: string, body?: CfEnvelope<unknown>) {
  const message = body?.errors?.[0]?.message ?? fallback
  return new Error(`cloudflare API failed (${status}): ${message}`)
}

function detectDnsRecordType(origin: string): "A" | "AAAA" | "CNAME" {
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(origin)) return "A"
  if (/^[0-9a-f:]+$/i.test(origin) && origin.includes(":")) return "AAAA"
  return "CNAME"
}

function escapeExpressionValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

function pathExpression(paths: Array<string>): string {
  if (paths.length === 0) return "true"
  const parts = paths.map((path) => {
    const trimmed = path.trim()
    if (trimmed.endsWith("*")) {
      return `starts_with(http.request.uri.path, "${escapeExpressionValue(
        trimmed.slice(0, -1)
      )}")`
    }
    return `http.request.uri.path eq "${escapeExpressionValue(trimmed)}"`
  })
  return parts.length === 1 ? parts[0]! : `(${parts.join(" or ")})`
}

function cacheRuleExpression(hostname: string, paths: Array<string>): string {
  return `http.host eq "${escapeExpressionValue(hostname)}" and ${pathExpression(
    paths
  )}`
}

function buildCacheRule(input: UpsertCloudflareCdnInput): CfRulesetRule {
  const ttl = input.config.cache_ttl_s
  const enabled = ttl > 0
  return {
    ref: `ploydok-app-${input.appId}`,
    description: `Ploydok CDN cache for ${input.hostname}`,
    expression: cacheRuleExpression(input.hostname, input.config.cache_paths),
    action: "set_cache_settings",
    enabled,
    action_parameters: enabled
      ? {
          cache: true,
          edge_ttl: {
            mode: "override_origin",
            default: ttl,
          },
          browser_ttl: {
            mode: "respect_origin",
          },
        }
      : {
          cache: false,
        },
  }
}

export class CloudflareClient {
  private readonly fetchFn: CloudflareFetch

  constructor(
    private readonly apiToken: string,
    fetchFn: CloudflareFetch = fetch
  ) {
    this.fetchFn = fetchFn
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiToken}`,
      "Content-Type": "application/json",
    }
  }

  private async request<T>(
    path: string,
    init: RequestInit = {}
  ): Promise<CfEnvelope<T>> {
    const res = await this.fetchFn(`${CF_API}${path}`, {
      ...init,
      headers: { ...this.headers(), ...(init.headers ?? {}) },
    })
    const body = (await res.json().catch(() => null)) as CfEnvelope<T> | null
    if (!res.ok || !body?.success) {
      throw cfError(res.status, res.statusText, body ?? undefined)
    }
    return body
  }

  async verifyToken(): Promise<void> {
    await this.request<unknown>("/user/tokens/verify")
  }

  async listZones(): Promise<Array<CloudflareZone>> {
    const body = await this.request<Array<CfZone>>("/zones?per_page=50")
    return body.result.map((zone) => ({
      id: zone.id,
      name: zone.name,
      accountId: zone.account?.id ?? null,
    }))
  }

  async upsertProxiedDnsRecord(input: {
    zoneId: string
    hostname: string
    origin: string
  }): Promise<string> {
    const type = detectDnsRecordType(input.origin)
    const query = new URLSearchParams({
      name: input.hostname,
      per_page: "10",
    })
    const existing = await this.request<Array<CfDnsRecord>>(
      `/zones/${input.zoneId}/dns_records?${query.toString()}`
    )
    const record = existing.result.find((candidate) => {
      return candidate.name === input.hostname
    })

    const payload = {
      type,
      name: input.hostname,
      content: input.origin,
      ttl: 1,
      proxied: true,
    }

    if (record) {
      const updated = await this.request<CfDnsRecord>(
        `/zones/${input.zoneId}/dns_records/${record.id}`,
        {
          method: "PATCH",
          body: JSON.stringify(payload),
        }
      )
      return updated.result.id
    }

    const created = await this.request<CfDnsRecord>(
      `/zones/${input.zoneId}/dns_records`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    )
    return created.result.id
  }

  async upsertCacheRule(
    input: UpsertCloudflareCdnInput
  ): Promise<{ rulesetId: string | null; ruleId: string | null }> {
    const rule = buildCacheRule(input)
    const phasePath = `/zones/${input.zoneId}/rulesets/phases/http_request_cache_settings/entrypoint`

    const existingRes = await this.fetchFn(`${CF_API}${phasePath}`, {
      headers: this.headers(),
    })

    if (existingRes.status === 404) {
      const created = await this.request<CfRuleset>(
        `/zones/${input.zoneId}/rulesets`,
        {
          method: "POST",
          body: JSON.stringify({
            name: "Ploydok cache rules",
            kind: "zone",
            phase: "http_request_cache_settings",
            rules: [rule],
          }),
        }
      )
      const createdRule = created.result.rules?.find((candidate) => {
        return candidate.ref === rule.ref
      })
      return {
        rulesetId: created.result.id,
        ruleId: createdRule?.id ?? null,
      }
    }

    const existing = (await existingRes.json()) as CfEnvelope<CfRuleset>
    if (!existingRes.ok || !existing.success) {
      throw cfError(existingRes.status, existingRes.statusText, existing)
    }

    const existingRule = existing.result.rules?.find((candidate) => {
      return candidate.ref === rule.ref
    })
    if (existingRule?.id) {
      const updated = await this.request<CfRulesetRule>(
        `/zones/${input.zoneId}/rulesets/${existing.result.id}/rules/${existingRule.id}`,
        {
          method: "PATCH",
          body: JSON.stringify(rule),
        }
      )
      return {
        rulesetId: existing.result.id,
        ruleId: updated.result.id ?? existingRule.id,
      }
    }

    const createdRule = await this.request<CfRulesetRule>(
      `/zones/${input.zoneId}/rulesets/${existing.result.id}/rules`,
      {
        method: "POST",
        body: JSON.stringify({
          ...rule,
          position: { index: 0 },
        }),
      }
    )
    return {
      rulesetId: existing.result.id,
      ruleId: createdRule.result.id ?? null,
    }
  }

  async purgeHostname(zoneId: string, hostname: string): Promise<void> {
    await this.request<{ id: string }>(`/zones/${zoneId}/purge_cache`, {
      method: "POST",
      body: JSON.stringify({ hosts: [hostname] }),
    })
  }

  async configureManagedCdn(
    input: UpsertCloudflareCdnInput
  ): Promise<UpsertCloudflareCdnResult> {
    const [dnsRecordId, cacheRule] = await Promise.all([
      this.upsertProxiedDnsRecord({
        zoneId: input.zoneId,
        hostname: input.hostname,
        origin: input.origin,
      }),
      this.upsertCacheRule(input),
    ])
    return {
      dnsRecordId,
      rulesetId: cacheRule.rulesetId,
      rulesetRuleId: cacheRule.ruleId,
    }
  }
}
