// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, mock, beforeEach, spyOn } from "bun:test"

import * as dbQueries from "@ploydok/db/queries"
import * as queueClaimMod from "../queue-claim"
import * as queueAuditMod from "../queue-audit"
import * as verifierMod from "../../domains/verifier"
import * as caddyClientMod from "../../caddy/client"

const MOCK_DOMAIN = {
  id: "dom-1",
  app_id: "app-1",
  hostname: "example.com",
  tls_status: "pending",
  tls_mode: "http01",
  dns01_provider: null,
  verify_token: "abc123",
  verify_error: null,
  requested_by_user_id: "user-1",
  verify_source: "api",
  verify_claimed_at: null,
  created_at: new Date(),
  updated_at: new Date(),
}

function createMockDb() {
  return {
    update: mock(() => ({
      set: mock(() => ({
        where: mock(() => Promise.resolve()),
      })),
    })),
  } as any
}

describe("handleDomainVerify", () => {
  beforeEach(() => {
    mock.restore()
  })

  it("rejects payload with non-existent domainId", async () => {
    const { handleDomainVerify } = await import("./domain-verify.js")
    const fakeDb = createMockDb()

    const claimSpy = spyOn(queueClaimMod, "claimQueuedRow").mockResolvedValue(
      null
    )
    const auditUnauthorizedSpy = spyOn(queueAuditMod, "auditUnauthorized")

    try {
      await handleDomainVerify(fakeDb, { domainId: "dom-nonexistent" })
      expect.unreachable("should have thrown")
    } catch (err) {
      expect((err as Error).message).toContain(
        "not found or not in pending/running state"
      )
    }

    expect(auditUnauthorizedSpy).toHaveBeenCalled()
  })

  it("claim succeeds on first attempt (pending → running)", async () => {
    const { handleDomainVerify } = await import("./domain-verify.js")
    const fakeDb = createMockDb()

    const claimedDomain = { ...MOCK_DOMAIN, tls_status: "running" }

    spyOn(queueClaimMod, "claimQueuedRow").mockResolvedValue(claimedDomain)
    spyOn(dbQueries, "getAppForUser").mockResolvedValue({
      id: "app-1",
    } as any)
    spyOn(verifierMod, "verifyDomain").mockResolvedValue({
      ok: true,
    })
    spyOn(
      caddyClientMod.CaddyClient.prototype,
      "getUpstream"
    ).mockResolvedValue({
      host: "127.0.0.1",
      port: 3000,
    })
    spyOn(
      caddyClientMod.CaddyClient.prototype,
      "upsertRoute"
    ).mockResolvedValue(undefined)
    const auditClaimedSpy = spyOn(queueAuditMod, "auditClaimed")

    await handleDomainVerify(fakeDb, { domainId: "dom-1" })

    expect(auditClaimedSpy).toHaveBeenCalled()
  })

  it("claim succeeds on retry (running → running, no rollback)", async () => {
    const { handleDomainVerify } = await import("./domain-verify.js")
    const fakeDb = createMockDb()

    const retryDomain = {
      ...MOCK_DOMAIN,
      tls_status: "running",
      verify_claimed_at: new Date(),
    }

    spyOn(queueClaimMod, "claimQueuedRow").mockResolvedValue(retryDomain)
    spyOn(dbQueries, "getAppForUser").mockResolvedValue({
      id: "app-1",
    } as any)
    spyOn(verifierMod, "verifyDomain").mockResolvedValue({
      ok: true,
    })
    spyOn(
      caddyClientMod.CaddyClient.prototype,
      "getUpstream"
    ).mockResolvedValue({
      host: "127.0.0.1",
      port: 3000,
    })
    spyOn(
      caddyClientMod.CaddyClient.prototype,
      "upsertRoute"
    ).mockResolvedValue(undefined)

    // Should not throw on retry
    await handleDomainVerify(fakeDb, { domainId: "dom-1" })
  })

  it("rejects non-claimable domain rows missing trust metadata", async () => {
    const { handleDomainVerify } = await import("./domain-verify.js")
    const fakeDb = createMockDb()

    spyOn(queueClaimMod, "claimQueuedRow").mockResolvedValue({
      ...MOCK_DOMAIN,
      requested_by_user_id: null,
      verify_source: null,
    })
    const auditUnauthorizedSpy = spyOn(queueAuditMod, "auditUnauthorized")
    const verifyDomainSpy = spyOn(verifierMod, "verifyDomain").mockResolvedValue({
      ok: true,
    })

    try {
      await handleDomainVerify(fakeDb, { domainId: "dom-1" })
      expect.unreachable("should have thrown")
    } catch (err) {
      expect((err as Error).message).toContain("not claimable")
    }

    expect(auditUnauthorizedSpy).toHaveBeenCalled()
    expect(verifyDomainSpy).not.toHaveBeenCalled()
  })

  it("claim drops if domain status is verified (no double-verify)", async () => {
    const { handleDomainVerify } = await import("./domain-verify.js")
    const fakeDb = createMockDb()

    spyOn(queueClaimMod, "claimQueuedRow").mockResolvedValue(null)
    const auditUnauthorizedSpy = spyOn(queueAuditMod, "auditUnauthorized")

    try {
      await handleDomainVerify(fakeDb, { domainId: "dom-1" })
      expect.unreachable("should have thrown")
    } catch (err) {
      expect((err as Error).message).toContain(
        "not found or not in pending/running state"
      )
    }

    expect(auditUnauthorizedSpy).toHaveBeenCalled()
  })
})
