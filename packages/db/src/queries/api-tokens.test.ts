// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from "bun:test"
import { createHash } from "crypto"

describe("api-tokens", () => {
  it("hashes token consistently", () => {
    const token = "ploy_test1234567890"
    const hash1 = createHash("sha256").update(token).digest("hex")
    const hash2 = createHash("sha256").update(token).digest("hex")
    expect(hash1).toBe(hash2)
  })

  it("generates different hashes for different tokens", () => {
    const token1 = "ploy_test1234567890"
    const token2 = "ploy_test0987654321"
    const hash1 = createHash("sha256").update(token1).digest("hex")
    const hash2 = createHash("sha256").update(token2).digest("hex")
    expect(hash1).not.toBe(hash2)
  })
})
