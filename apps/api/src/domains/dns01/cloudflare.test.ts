// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from "bun:test"
import { createCloudflareProvider } from "./cloudflare.js"
import type { CloudflareCredentials, FetchFn } from "./types.js"

const creds: CloudflareCredentials = {
  provider: "cloudflare",
  api_token: "test-token",
  zone_id: "zone123",
}

describe("CloudflareProvider", () => {
  test("createTXTRecord — success", async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = []
    const mockFetch: FetchFn = async (url, init) => {
      const body = init?.body ? JSON.parse(init.body as string) : null
      calls.push({ url: url.toString(), method: init?.method ?? "GET", body })
      return new Response(
        JSON.stringify({ success: true, errors: [], result: { id: "rec-abc" } }),
        { status: 200 },
      )
    }

    const provider = createCloudflareProvider(creds, mockFetch)
    const result = await provider.createTXTRecord("example.com", "_ploydok-verify.example.com", "token123")

    expect(result.recordId).toBe("rec-abc")
    expect(calls[0]?.url).toContain("/zones/zone123/dns_records")
    expect(calls[0]?.method).toBe("POST")
    expect(calls[0]?.body).toMatchObject({ type: "TXT", name: "_ploydok-verify.example.com", content: "token123" })
  })

  test("createTXTRecord — 403 throws", async () => {
    const mockFetch: FetchFn = async () =>
      new Response(
        JSON.stringify({ success: false, errors: [{ message: "Authentication error" }], result: null }),
        { status: 403 },
      )

    const provider = createCloudflareProvider(creds, mockFetch)
    await expect(provider.createTXTRecord("example.com", "_verify.example.com", "tok")).rejects.toThrow(
      "cloudflare.createTXTRecord failed (403): Authentication error",
    )
  })

  test("deleteTXTRecord — success", async () => {
    const calls: Array<{ url: string; method: string }> = []
    const mockFetch: FetchFn = async (url, init) => {
      calls.push({ url: url.toString(), method: init?.method ?? "GET" })
      return new Response(JSON.stringify({ id: "rec-abc" }), { status: 200 })
    }

    const provider = createCloudflareProvider(creds, mockFetch)
    await provider.deleteTXTRecord("example.com", "rec-abc")

    expect(calls[0]?.url).toContain("/zones/zone123/dns_records/rec-abc")
    expect(calls[0]?.method).toBe("DELETE")
  })

  test("deleteTXTRecord — 401 throws", async () => {
    const mockFetch: FetchFn = async () => new Response("Unauthorized", { status: 401 })

    const provider = createCloudflareProvider(creds, mockFetch)
    await expect(provider.deleteTXTRecord("example.com", "rec-id")).rejects.toThrow(
      "cloudflare.deleteTXTRecord failed (401)",
    )
  })

  test("createCloudflareProvider — throws when no auth provided", () => {
    const badCreds: CloudflareCredentials = { provider: "cloudflare", zone_id: "z" }
    expect(() => createCloudflareProvider(badCreds)).toThrow("must provide api_token or api_key+email")
  })
})
