// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from "bun:test"
import { createDigitalOceanProvider } from "./digitalocean.js"
import type { DigitalOceanCredentials, FetchFn } from "./types.js"

const creds: DigitalOceanCredentials = {
  provider: "digitalocean",
  token: "do-token-test",
}

describe("DigitalOceanProvider", () => {
  test("createTXTRecord — success", async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = []
    const mockFetch: FetchFn = async (url, init) => {
      const body = init?.body ? JSON.parse(init.body as string) : null
      calls.push({ url: url.toString(), method: init?.method ?? "GET", body })
      return new Response(
        JSON.stringify({ domain_record: { id: 99, type: "TXT", name: "_ploydok-verify", data: "tok" } }),
        { status: 201 },
      )
    }

    const provider = createDigitalOceanProvider(creds, mockFetch)
    const result = await provider.createTXTRecord("example.com", "_ploydok-verify.example.com", "tok")

    expect(result.recordId).toBe("99")
    expect(calls[0]?.url).toContain("/domains/example.com/records")
    expect(calls[0]?.method).toBe("POST")
    expect(calls[0]?.body).toMatchObject({ type: "TXT", data: "tok" })
  })

  test("createTXTRecord — 401 throws", async () => {
    const mockFetch: FetchFn = async () =>
      new Response(JSON.stringify({ id: "Unauthorized", message: "Unable to authenticate" }), { status: 401 })

    const provider = createDigitalOceanProvider(creds, mockFetch)
    await expect(provider.createTXTRecord("example.com", "_verify.example.com", "tok")).rejects.toThrow(
      "digitalocean.createTXTRecord failed (401)",
    )
  })

  test("deleteTXTRecord — success", async () => {
    const calls: Array<{ url: string; method: string }> = []
    const mockFetch: FetchFn = async (url, init) => {
      calls.push({ url: url.toString(), method: init?.method ?? "GET" })
      return new Response("", { status: 204 })
    }

    const provider = createDigitalOceanProvider(creds, mockFetch)
    await provider.deleteTXTRecord("example.com", "99")

    expect(calls[0]?.url).toContain("/domains/example.com/records/99")
    expect(calls[0]?.method).toBe("DELETE")
  })

  test("deleteTXTRecord — 404 is idempotent", async () => {
    const mockFetch: FetchFn = async () => new Response("Not Found", { status: 404 })
    const provider = createDigitalOceanProvider(creds, mockFetch)
    await expect(provider.deleteTXTRecord("example.com", "999")).resolves.toBeUndefined()
  })
})
