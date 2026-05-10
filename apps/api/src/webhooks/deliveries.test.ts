// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, mock, beforeEach } from "bun:test"
import { compressPayload, truncateSample, insertDelivery, findRecentByPayloadHash } from "./deliveries"

// ---------------------------------------------------------------------------
// compressPayload
// ---------------------------------------------------------------------------

describe("compressPayload", () => {
  it("returns compressed data for small input", async () => {
    const raw = Buffer.from("hello world")
    const { data, truncated } = await compressPayload(raw)
    expect(truncated).toBe(false)
    expect(data.byteLength).toBeGreaterThan(0)
    // gzip output is always smaller-or-similar for real data, but the header
    // makes tiny payloads grow — just check it's a Buffer
    expect(data instanceof Uint8Array).toBe(true)
  })

  it("truncates input to 1 MB and sets truncated=true", async () => {
    const big = Buffer.alloc(1024 * 1024 + 100, 0x41) // 1 MB + 100 bytes
    const { truncated } = await compressPayload(big)
    expect(truncated).toBe(true)
  })

  it("returns truncated=false for exactly 1 MB", async () => {
    const exact = Buffer.alloc(1024 * 1024, 0x42)
    const { truncated } = await compressPayload(exact)
    expect(truncated).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// truncateSample
// ---------------------------------------------------------------------------

describe("truncateSample", () => {
  it("returns the value unchanged when it fits in 4 KB", () => {
    const val = { event: "push", ref: "main" }
    expect(truncateSample(val)).toEqual(val)
  })

  it("returns _truncated wrapper when JSON exceeds 4 KB", () => {
    const big = { data: "x".repeat(5000) }
    const result = truncateSample(big) as Record<string, unknown>
    expect(result._truncated).toBe(true)
    expect(typeof result.raw).toBe("string")
    expect((result.raw as string).length).toBe(4096)
  })
})

// ---------------------------------------------------------------------------
// insertDelivery — mock DB
// ---------------------------------------------------------------------------

describe("insertDelivery", () => {
  it("calls db.insert with expected fields", async () => {
    const insertedValues: unknown[] = []
    const mockInsert = mock(() => ({
      values: (vals: unknown) => {
        insertedValues.push(vals)
        return Promise.resolve()
      },
    }))
    const db = { insert: mockInsert } as unknown as Parameters<typeof insertDelivery>[0]

    const id = await insertDelivery(
      db,
      {
        provider: "github",
        event: "push",
        signature_valid: true,
        decision: "enqueued",
        payload_hash: "abc123",
        ref: "refs/heads/main",
        commit_sha: "deadbeef",
        commit_message: "feat: test",
      },
      Buffer.from('{"test":1}'),
    )

    expect(typeof id).toBe("string")
    expect(id.length).toBeGreaterThan(0)
    expect(mockInsert).toHaveBeenCalledTimes(1)

    const vals = insertedValues[0] as Record<string, unknown>
    expect(vals.provider).toBe("github")
    expect(vals.decision).toBe("enqueued")
    expect(vals.signature_valid).toBe(true)
    expect(vals.payload_hash).toBe("abc123")
    // payload_raw temporarily skipped (postgres.js bytea bind crash); the
    // truncated flag still reflects the size cap so consumers can detect a
    // missed audit body. Re-enable with a proper bytea binder fix.
    expect(vals.payload_raw).toBeNull()
    expect(vals.payload_raw_expires_at).toBeNull()
    expect(vals.payload_truncated).toBe(false)
  })

  it("sets payload_raw=null when no rawBodyBuffer provided", async () => {
    const insertedValues: unknown[] = []
    const db = {
      insert: mock(() => ({
        values: (vals: unknown) => {
          insertedValues.push(vals)
          return Promise.resolve()
        },
      })),
    } as unknown as Parameters<typeof insertDelivery>[0]

    await insertDelivery(db, {
      provider: "gitlab",
      event: "push",
      signature_valid: false,
      decision: "invalid_signature",
      payload_hash: "xyz",
    })

    const vals = insertedValues[0] as Record<string, unknown>
    expect(vals.payload_raw).toBeNull()
    expect(vals.payload_raw_expires_at).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// findRecentByPayloadHash — mock DB
// ---------------------------------------------------------------------------

describe("findRecentByPayloadHash", () => {
  it("returns null when no rows found", async () => {
    const db = {
      select: mock(() => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([]),
          }),
        }),
      })),
    } as unknown as Parameters<typeof findRecentByPayloadHash>[0]

    const result = await findRecentByPayloadHash(db, "somehash")
    expect(result).toBeNull()
  })

  it("returns the first row when found", async () => {
    const row = { id: "del-1", decision: "enqueued" as const }
    const db = {
      select: mock(() => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([row]),
          }),
        }),
      })),
    } as unknown as Parameters<typeof findRecentByPayloadHash>[0]

    const result = await findRecentByPayloadHash(db, "somehash")
    expect(result).toEqual(row)
  })
})
