// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Smoke tests for apps-domains lib — tests query key factory and endpoint
 * construction without importing React hooks.
 */
import { describe, expect, it } from "bun:test"
import { domainsQueryKey } from "../../lib/apps-domains"

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------

describe("domainsQueryKey", () => {
  it("produces the expected tuple", () => {
    expect(domainsQueryKey("app-123")).toEqual(["apps", "app-123", "domains"])
  })

  it("is scoped per app ID", () => {
    const k1 = domainsQueryKey("aaa")
    const k2 = domainsQueryKey("bbb")
    expect(k1).not.toEqual(k2)
    expect(k1[1]).toBe("aaa")
    expect(k2[1]).toBe("bbb")
  })

  it("always has 'domains' as the third segment", () => {
    const key = domainsQueryKey("any-app")
    expect(key[2]).toBe("domains")
  })
})

// ---------------------------------------------------------------------------
// Endpoint construction (mirrors the hook logic)
// ---------------------------------------------------------------------------

function listDomainsEndpoint(appId: string): string {
  return `/apps/${appId}/domains`
}

function addDomainEndpoint(appId: string): string {
  return `/apps/${appId}/domains`
}

function deleteDomainEndpoint(appId: string, domainId: string): string {
  return `/apps/${appId}/domains/${domainId}`
}

function recheckDomainEndpoint(appId: string, domainId: string): string {
  return `/apps/${appId}/domains/${domainId}/recheck`
}

describe("apps-domains — endpoint construction", () => {
  it("GET list endpoint is correct", () => {
    expect(listDomainsEndpoint("app-abc")).toBe("/apps/app-abc/domains")
  })

  it("POST add endpoint is correct", () => {
    expect(addDomainEndpoint("app-abc")).toBe("/apps/app-abc/domains")
  })

  it("DELETE endpoint includes domainId", () => {
    expect(deleteDomainEndpoint("app-abc", "dom-xyz")).toBe(
      "/apps/app-abc/domains/dom-xyz",
    )
  })

  it("POST recheck endpoint includes /recheck suffix", () => {
    expect(recheckDomainEndpoint("app-abc", "dom-xyz")).toBe(
      "/apps/app-abc/domains/dom-xyz/recheck",
    )
  })
})
