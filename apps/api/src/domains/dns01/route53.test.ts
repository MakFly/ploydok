// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from "bun:test"
import { createRoute53Provider } from "./route53.js"
import type { Route53Credentials, FetchFn } from "./types.js"

const creds: Route53Credentials = {
  provider: "route53",
  access_key_id: "AKIATEST",
  secret_access_key: "secret",
  region: "us-east-1",
}

describe("Route53Provider", () => {
  test("createTXTRecord — success returns recordId with name", async () => {
    const mockFetch: FetchFn = async () =>
      new Response(
        `<?xml version="1.0" encoding="UTF-8"?><ChangeResourceRecordSetsResponse><ChangeInfo><Id>/change/C123</Id><Status>PENDING</Status></ChangeInfo></ChangeResourceRecordSetsResponse>`,
        { status: 200, headers: { "content-type": "application/xml" } },
      )

    const provider = createRoute53Provider(creds, "ZONE123", mockFetch)
    const result = await provider.createTXTRecord("example.com", "_ploydok-verify.example.com", "tok")

    expect(result.recordId).toContain("_ploydok-verify.example.com")
    expect(result.recordId).toContain("/change/C123")
  })

  test("createTXTRecord — 403 throws", async () => {
    const mockFetch: FetchFn = async () =>
      new Response(
        `<?xml version="1.0"?><ErrorResponse><Error><Message>SignatureDoesNotMatch</Message></Error></ErrorResponse>`,
        { status: 403, headers: { "content-type": "application/xml" } },
      )

    const provider = createRoute53Provider(creds, "ZONE123", mockFetch)
    await expect(
      provider.createTXTRecord("example.com", "_verify.example.com", "tok"),
    ).rejects.toThrow("route53.changeResourceRecordSets failed (403)")
  })

  test("deleteTXTRecord — sends DELETE ChangeResourceRecordSets", async () => {
    const calls: Array<{ url: string; method: string; body: string }> = []
    const mockFetch: FetchFn = async (url, init) => {
      calls.push({ url: url.toString(), method: init?.method ?? "GET", body: (init?.body as string) ?? "" })
      return new Response(
        `<?xml version="1.0"?><ChangeResourceRecordSetsResponse><ChangeInfo><Id>/change/D456</Id><Status>PENDING</Status></ChangeInfo></ChangeResourceRecordSetsResponse>`,
        { status: 200, headers: { "content-type": "application/xml" } },
      )
    }

    const provider = createRoute53Provider(creds, "ZONE123", mockFetch)
    // recordId format: "<changeId>|<name>"
    await provider.deleteTXTRecord("example.com", "/change/C123|_verify.example.com")

    expect(calls[0]?.body).toContain("<Action>DELETE</Action>")
    expect(calls[0]?.body).toContain("_verify.example.com")
  })
})
