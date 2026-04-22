// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from "bun:test"
import { createOvhProvider } from "./ovh.js"
import type { OvhCredentials, FetchFn } from "./types.js"

const creds: OvhCredentials = {
  provider: "ovh",
  application_key: "appkey",
  application_secret: "appsecret",
  consumer_key: "consumerkey",
  endpoint: "ovh-eu",
}

describe("OvhProvider", () => {
  test("createTXTRecord — success", async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = []
    let callIndex = 0
    const mockFetch: FetchFn = async (url, init) => {
      const body = init?.body ? JSON.parse(init.body as string) : null
      calls.push({ url: url.toString(), method: init?.method ?? "GET", body })
      callIndex++
      if (callIndex === 1) {
        // POST create record
        return new Response(
          JSON.stringify({ id: 42, fieldType: "TXT", subDomain: "_ploydok-verify", target: '"tok"', ttl: 10 }),
          { status: 200 },
        )
      }
      // POST refresh zone
      return new Response("{}", { status: 200 })
    }

    const provider = createOvhProvider(creds, mockFetch)
    const result = await provider.createTXTRecord("example.com", "_ploydok-verify.example.com", "tok")

    expect(result.recordId).toBe("42")
    expect(calls[0]?.url).toContain("/domain/zone/example.com/record")
    expect(calls[0]?.method).toBe("POST")
    expect(calls[0]?.body).toMatchObject({ fieldType: "TXT" })
  })

  test("createTXTRecord — 403 throws", async () => {
    const mockFetch: FetchFn = async () => new Response("Forbidden", { status: 403 })
    const provider = createOvhProvider(creds, mockFetch)
    await expect(provider.createTXTRecord("example.com", "_verify.example.com", "tok")).rejects.toThrow(
      "ovh.createTXTRecord failed (403)",
    )
  })

  test("deleteTXTRecord — success", async () => {
    const calls: Array<{ url: string; method: string }> = []
    let callIndex = 0
    const mockFetch: FetchFn = async (url, init) => {
      calls.push({ url: url.toString(), method: init?.method ?? "GET" })
      callIndex++
      return new Response(callIndex === 1 ? "" : "{}", { status: 200 })
    }

    const provider = createOvhProvider(creds, mockFetch)
    await provider.deleteTXTRecord("example.com", "42")

    expect(calls[0]?.url).toContain("/domain/zone/example.com/record/42")
    expect(calls[0]?.method).toBe("DELETE")
  })
})
