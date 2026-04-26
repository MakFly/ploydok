// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from "bun:test"
import { verifyDomain } from "./verifier.js"
import type { Db } from "@ploydok/db"

// ---------------------------------------------------------------------------
// Minimal mock DB
// ---------------------------------------------------------------------------

type DomainRow = {
  id: string
  hostname: string
  verify_token: string | null
  tls_status: "pending" | "issued" | "failed"
  tls_mode: "http01" | "dns01"
  dns01_provider: string | null
  verify_error: string | null
  app_id: string
  created_at: Date
  updated_at: Date
}

function makeMockDb(domain: DomainRow | null): Db {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(domain ? [domain] : []),
        }),
      }),
    }),
  } as unknown as Db
}

const baseDomain: DomainRow = {
  id: "dom1",
  hostname: "app.example.com",
  verify_token: "abc123token",
  tls_status: "pending",
  tls_mode: "http01",
  dns01_provider: null,
  verify_error: null,
  app_id: "app1",
  created_at: new Date(),
  updated_at: new Date(),
}

describe("verifyDomain", () => {
  test("ok=true when TXT record matches token", async () => {
    const db = makeMockDb(baseDomain)
    const mockResolve = async (_host: string) => [["abc123token"]]

    const result = await verifyDomain(db, "dom1", mockResolve)
    expect(result.ok).toBe(true)
  })

  test("ok=false when TXT record does not match", async () => {
    const db = makeMockDb(baseDomain)
    const mockResolve = async (_host: string) => [["wrong-token"]]

    const result = await verifyDomain(db, "dom1", mockResolve)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain("did not match")
  })

  test("ok=false when ENOTFOUND", async () => {
    const db = makeMockDb(baseDomain)
    const mockResolve = async (_host: string): Promise<string[][]> => {
      const err = new Error("ENOTFOUND") as NodeJS.ErrnoException
      err.code = "ENOTFOUND"
      throw err
    }

    const result = await verifyDomain(db, "dom1", mockResolve)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe("TXT record not found")
  })

  test("ok=false when ENODATA", async () => {
    const db = makeMockDb(baseDomain)
    const mockResolve = async (_host: string): Promise<string[][]> => {
      const err = new Error("ENODATA") as NodeJS.ErrnoException
      err.code = "ENODATA"
      throw err
    }

    const result = await verifyDomain(db, "dom1", mockResolve)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe("TXT record not found")
  })

  test("ok=false when domain not found in DB", async () => {
    const db = makeMockDb(null)
    const mockResolve = async () => [["tok"]]

    const result = await verifyDomain(db, "nonexistent", mockResolve)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe("domain not found")
  })

  test("ok=false when no verify_token set", async () => {
    const db = makeMockDb({ ...baseDomain, verify_token: null })
    const mockResolve = async () => [["tok"]]

    const result = await verifyDomain(db, "dom1", mockResolve)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe("no verify_token set")
  })

  test("ok=true when multiple TXT records and one matches", async () => {
    const db = makeMockDb(baseDomain)
    const mockResolve = async (_host: string) => [["other"], ["abc123token"], ["more"]]

    const result = await verifyDomain(db, "dom1", mockResolve)
    expect(result.ok).toBe(true)
  })

  test("wildcard domains use the parent hostname for TXT lookup", async () => {
    const db = makeMockDb({
      ...baseDomain,
      hostname: "*.wild.example.com",
      tls_mode: "dns01",
      dns01_provider: "cloudflare",
    })
    let lookupName = ""
    const mockResolve = async (host: string) => {
      lookupName = host
      return [["abc123token"]]
    }

    const result = await verifyDomain(db, "dom1", mockResolve)
    expect(result.ok).toBe(true)
    expect(lookupName).toBe("_ploydok-verify.wild.example.com")
  })
})
