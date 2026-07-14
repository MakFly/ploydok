// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test, beforeEach } from "bun:test"
import {
  __resetSetupTokenForTest,
  bootstrapSetupToken,
  clearSetupToken,
  consumeSetupToken,
  getSetupTokenState,
  validateSetupToken,
} from "./setup-token"
import type { Db } from "@ploydok/db"

function makeDb(userCount: number): Db {
  return {
    select: () => ({
      from: () => ({
        limit: async () =>
          Array.from({ length: userCount }, (_, i) => ({ id: `u${i}` })),
      }),
    }),
  } as unknown as Db
}

describe("setup-token", () => {
  beforeEach(() => {
    __resetSetupTokenForTest()
    delete Bun.env["PLOYDOK_SETUP_TOKEN"]
  })

  test("does not generate a token when users already exist", async () => {
    await bootstrapSetupToken(makeDb(1))
    expect(getSetupTokenState().active).toBe(false)
  })

  test("generates a single-use token on empty DB", async () => {
    await bootstrapSetupToken(makeDb(0))
    expect(getSetupTokenState().active).toBe(true)
  })

  test("rejects mismatched tokens", async () => {
    await bootstrapSetupToken(makeDb(0))
    expect(consumeSetupToken("wrong")).toBe(false)
    expect(consumeSetupToken(undefined)).toBe(false)
  })

  test("clearSetupToken disables further consumption", async () => {
    await bootstrapSetupToken(makeDb(0))
    clearSetupToken()
    expect(getSetupTokenState().active).toBe(false)
  })

  test("env override has no expiry but is consumed once", async () => {
    Bun.env["PLOYDOK_SETUP_TOKEN"] = "x".repeat(32)
    await bootstrapSetupToken(makeDb(0))
    const state = getSetupTokenState()
    expect(state.active).toBe(true)
    expect(state.expires_at).toBeNull()
    expect(validateSetupToken("x".repeat(32))).toBe(true)
    expect(validateSetupToken("x".repeat(32))).toBe(true)
    expect(consumeSetupToken("x".repeat(32))).toBe(true)
    expect(consumeSetupToken("x".repeat(32))).toBe(false)
    expect(getSetupTokenState().active).toBe(false)
  })

  test("bootstrap is idempotent", async () => {
    await bootstrapSetupToken(makeDb(0))
    const first = getSetupTokenState()
    await bootstrapSetupToken(makeDb(0))
    const second = getSetupTokenState()
    expect(first.expires_at).toBe(second.expires_at)
  })
})
