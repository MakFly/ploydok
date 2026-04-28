// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { createDb } from "../client"
import { users } from "../schema"
import {
  insertAuditLogSigned,
  getAuditChainTail,
  getLatestAnchor,
  insertAuditAnchor,
} from "./audit-log"

const PG_URL = Bun.env["PLOYDOK_TEST_PG_URL"]
const MIGRATIONS_DIR = join(import.meta.dir, "../../migrations")

const skip = !PG_URL
if (skip) {
  console.log(
    "[audit-log.test] PLOYDOK_TEST_PG_URL not set — skipping Postgres tests"
  )
}

describe.skipIf(skip)("audit-log queries", () => {
  const db = createDb(PG_URL!)
  let sql: ReturnType<typeof postgres>

  let userId: string

  beforeAll(async () => {
    sql = postgres(PG_URL!, { max: 1 })
    const migDb = drizzle(sql)
    await migrate(migDb, { migrationsFolder: MIGRATIONS_DIR })

    const now = new Date()
    userId = `audit-test-user-${Date.now()}`

    await db.insert(users).values({
      id: userId,
      email: `${userId}@test.local`,
      display_name: "Audit Test User",
      created_at: now,
      updated_at: now,
    })
  })

  afterAll(async () => {
    await sql.end()
  })

  it("insertAuditLogSigned with signFn that returns signature", async () => {
    const entry = {
      user_id: userId,
      action: "test.signed",
      target_type: "test",
      target_id: "test-1",
      metadata: { test: true },
      created_at: new Date(),
      org_id: "test-org-1",
    }

    const signFn = async () => ({
      signature: "abcd1234efgh5678ijkl9012mnop3456qrst7890uvwx1234yzab5678cdef",
      keyId: "key-test-1",
    })

    const result = await insertAuditLogSigned(db, entry, signFn)

    expect(result).not.toBeNull()
    expect(result!.signature).toBe(
      "abcd1234efgh5678ijkl9012mnop3456qrst7890uvwx1234yzab5678cdef"
    )
    expect(result!.key_id).toBe("key-test-1")
    expect(result!.hash).not.toBeNull()
    expect(result!.prev_hash).toBeNull() // First entry
  })

  it("insertAuditLogSigned with signFn that returns null (degraded mode)", async () => {
    const entry = {
      user_id: userId,
      action: "test.unsigned",
      target_type: "test",
      target_id: "test-2",
      metadata: { test: false },
      created_at: new Date(),
      org_id: "test-org-1",
    }

    const signFn = async () => null

    const result = await insertAuditLogSigned(db, entry, signFn)

    expect(result).not.toBeNull()
    expect(result!.signature).toBeNull()
    expect(result!.key_id).toBeNull()
    expect(result!.hash).not.toBeNull()
  })

  it("getLatestAnchor on empty table returns null", async () => {
    const result = await getLatestAnchor(db)
    expect(result).toBeNull()
  })

  it("insertAuditAnchor and getLatestAnchor roundtrip", async () => {
    const now = new Date()
    const anchor = await insertAuditAnchor(db, {
      headAuditId: 1,
      headHash: "abc123def456",
      signature: "anchor-sig-1234567890abcdefghijklmnopqrstuvwxyz1234567890",
      keyId: "anchor-key-1",
      signedAt: now,
    })

    expect(anchor.id).not.toBeNull()
    expect(anchor.head_audit_id).toBe(1)
    expect(anchor.head_hash).toBe("abc123def456")

    const retrieved = await getLatestAnchor(db)
    expect(retrieved).not.toBeNull()
    expect(retrieved!.id).toBe(anchor.id)
    expect(retrieved!.signature).toBe(
      "anchor-sig-1234567890abcdefghijklmnopqrstuvwxyz1234567890"
    )
    expect(retrieved!.key_id).toBe("anchor-key-1")
  })

  it("canonical payload format is exactly as specified", async () => {
    const entry = {
      user_id: userId,
      action: "test.canonical",
      target_type: "test-type",
      target_id: "test-id-123",
      metadata: { key: "value" },
      created_at: new Date("2026-04-28T10:30:00Z"),
      org_id: "test-org-1",
    }

    let capturedCanonical: Uint8Array | null = null
    const signFn = async (canonical: Uint8Array) => {
      capturedCanonical = canonical
      return {
        signature: "test-sig",
        keyId: "test-key",
      }
    }

    await insertAuditLogSigned(db, entry, signFn)

    expect(capturedCanonical).not.toBeNull()
    const canonicalStr = new TextDecoder().decode(capturedCanonical!)

    // Verify the canonical format matches v1 format
    const lines = canonicalStr.split("\n")
    expect(lines[0]).toBe("v1")
    expect(lines[1]).toMatch(/^\d+$/) // id is numeric
    expect(lines[2]).toMatch(/^\d{4}-\d{2}-\d{2}T/) // ISO timestamp
    expect(lines[3]).toBe(userId) // user_id
    expect(lines[4]).toBe("test.canonical") // action
    expect(lines[5]).toBe("test-type") // target_type
    expect(lines[6]).toBe("test-id-123") // target_id
    expect(lines[7]).toMatch(/^[a-f0-9]{64}$/) // sha256 metadata hash
    expect(lines[8]).toBe("->") // prev_hash (first entry)
    expect(lines[9]).toMatch(/^[a-f0-9]{64}$/) // hash
  })
})
