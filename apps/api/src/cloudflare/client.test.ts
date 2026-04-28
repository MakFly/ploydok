// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from "bun:test"
import { CloudflareClient, type CloudflareFetch } from "./client.js"

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

describe("CloudflareClient", () => {
  test("upserts a proxied DNS record", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = []
    const fetchFn: CloudflareFetch = async (url, init) => {
      calls.push({ url: String(url), init })
      if (String(url).includes("/dns_records?")) {
        return json({ success: true, result: [] })
      }
      return json({ success: true, result: { id: "dns-1" } })
    }

    const client = new CloudflareClient("cf-token", fetchFn)
    const id = await client.upsertProxiedDnsRecord({
      zoneId: "zone-1",
      hostname: "app.example.com",
      origin: "origin.example.com",
    })

    expect(id).toBe("dns-1")
    const create = calls.find((call) => call.init?.method === "POST")
    expect(create?.init?.body).toBe(
      JSON.stringify({
        type: "CNAME",
        name: "app.example.com",
        content: "origin.example.com",
        ttl: 1,
        proxied: true,
      })
    )
  })

  test("creates a cache ruleset entrypoint when missing", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = []
    const fetchFn: CloudflareFetch = async (url, init) => {
      calls.push({ url: String(url), init })
      if (!init?.method) {
        return json({ success: false, result: null }, 404)
      }
      return json({
        success: true,
        result: {
          id: "ruleset-1",
          rules: [{ id: "rule-1", ref: "ploydok-app-app-1" }],
        },
      })
    }

    const client = new CloudflareClient("cf-token", fetchFn)
    const result = await client.upsertCacheRule({
      appId: "app-1",
      zoneId: "zone-1",
      hostname: "app.example.com",
      origin: "origin.example.com",
      config: { cache_ttl_s: 600, cache_paths: ["/assets/*"] },
    })

    expect(result).toEqual({ rulesetId: "ruleset-1", ruleId: "rule-1" })
    const post = calls.find((call) => call.init?.method === "POST")
    const body = JSON.parse(String(post?.init?.body)) as {
      rules: Array<{
        ref: string
        expression: string
        action_parameters: { edge_ttl: { default: number } }
      }>
    }
    expect(body.rules[0]?.ref).toBe("ploydok-app-app-1")
    expect(body.rules[0]?.expression).toContain(
      'http.host eq "app.example.com"'
    )
    expect(body.rules[0]?.expression).toContain(
      'starts_with(http.request.uri.path, "/assets/")'
    )
    expect(body.rules[0]?.action_parameters.edge_ttl.default).toBe(600)
  })

  test("purges cache by hostname", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = []
    const fetchFn: CloudflareFetch = async (url, init) => {
      calls.push({ url: String(url), init })
      return json({ success: true, result: { id: "purge-1" } })
    }

    const client = new CloudflareClient("cf-token", fetchFn)
    await client.purgeHostname("zone-1", "app.example.com")

    expect(calls[0]?.url).toContain("/zones/zone-1/purge_cache")
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({ hosts: ["app.example.com"] })
    )
  })
})
